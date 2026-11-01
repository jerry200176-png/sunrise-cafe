#!/usr/bin/env python3
"""Run the read-only preview against synthetic schemas in an isolated local PG17."""

from pathlib import Path
import subprocess
import time
import unittest
import uuid

PREVIEW = (Path(__file__).resolve().parents[1] / "supabase/preview-menu-option-set-merge.sql").read_text()


class PreviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = "sunrise-option-preview-" + uuid.uuid4().hex[:12]
        subprocess.run([
            "docker", "run", "--rm", "-d", "--name", cls.container, "--network", "none", "--pull", "never",
            "--tmpfs", "/var/lib/postgresql/data:rw,size=96m", "--tmpfs", "/var/run/postgresql:rw,size=4m",
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine",
        ], check=True, capture_output=True, text=True)
        try:
            for _ in range(60):
                check = subprocess.run(["docker", "exec", cls.container, "pg_isready", "-U", "postgres"],
                                       capture_output=True, text=True)
                if check.returncode == 0:
                    return
                time.sleep(0.25)
            raise RuntimeError("isolated PostgreSQL did not become ready")
        except BaseException:
            subprocess.run(["docker", "rm", "-f", cls.container], capture_output=True, check=False)
            raise

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["docker", "rm", "-f", cls.container], capture_output=True, check=False)

    def run_preview(self, migrated):
        column = ", set_id text" if migrated else ""
        already_merged = "INSERT INTO menu_item_options VALUES (7,'4','溫度','冷',0,0,'set-1'), (8,'4','溫度','冷',0,1,'set-1'), (11,'1','溫度','附加',0,2,'set-1');" if migrated else ""
        empty_set = ",NULL" if migrated else ""
        sql = f"""
BEGIN;
CREATE TEMP TABLE branches (id text PRIMARY KEY, name text);
CREATE TEMP TABLE menu_items (id text PRIMARY KEY, name text, branch_id text);
CREATE TEMP TABLE menu_item_options (id integer, item_id text, option_group text, option_name text, price_delta numeric, display_order integer{column});
INSERT INTO branches VALUES ('b','大安'),('b2','西店');
INSERT INTO menu_items VALUES ('1','甲','b'),('2','乙','b'),('3','丙','b'),('4','丁','b'),('5','戊','b'),('6','己','b2');
INSERT INTO menu_item_options VALUES
 (1,'1','溫度','冰',0,1{empty_set}), (2,'1','溫度','熱',0,0{empty_set}),
 (3,'2','溫度','冰',0,0{empty_set}), (4,'2','溫度','熱',0,1{empty_set}),
 (5,'3','糖','甜',0,0{empty_set}), (6,'3','糖','甜',0,1{empty_set}),
 (9,'5','溫度','常溫',0,0{empty_set}), (10,'6','溫度','冷',0,0{empty_set});
{already_merged}
{PREVIEW}
ROLLBACK;
"""
        result = subprocess.run([
            "docker", "exec", "-i", self.container, "psql", "-X", "-q", "-A", "-t", "-F", "|",
            "-v", "ON_ERROR_STOP=1", "-U", "postgres", "postgres",
        ], input=sql, capture_output=True, text=True, check=True)
        return [line for line in result.stdout.splitlines() if line]

    def assert_expected_preview(self, lines):
        self.assertEqual(len(lines), 4)
        fields = next(line for line in lines if line.startswith("大安|溫度|1|")).split("|")
        self.assertEqual(fields[:5], ["大安", "溫度", "1", "熱、冰", "2"])
        # Branch-name ordering follows the actual database collation.
        self.assertEqual(set(fields[5].split("、")), {"甲", "乙"})
        self.assertIn("大安|溫度|2|常溫|1|戊", lines)
        self.assertIn("西店|溫度|1|冷|1|己", lines)
        self.assertIn("丙|糖", lines)

    def test_before_migration_without_set_id_column(self):
        self.assert_expected_preview(self.run_preview(False))

    def test_after_migration_skips_merged_duplicates(self):
        self.assert_expected_preview(self.run_preview(True))


if __name__ == "__main__":
    unittest.main()
