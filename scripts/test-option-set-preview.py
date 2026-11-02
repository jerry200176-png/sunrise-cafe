#!/usr/bin/env python3
"""Run the read-only preview against synthetic schemas in an isolated local PG17."""

from pathlib import Path
import json
import os
import stat
import subprocess
import time
import unittest
import uuid

PREVIEW = (Path(__file__).resolve().parents[1] / "supabase/preview-menu-option-set-merge.sql").read_text()
MIGRATION = (Path(__file__).resolve().parents[1] / "supabase/migration-menu-option-sets.sql").read_text()
MERGE_START = MIGRATION.index("DO $$", MIGRATION.index("-- 既有選項自動合併成選項組。"))
MERGE_SQL = MIGRATION[MERGE_START:MIGRATION.index("\n$$;", MERGE_START) + len("\n$$;")]
DOCKER_SOCKET = "/var/run/docker.sock"


def docker(args, **kwargs):
    return subprocess.run(
        ["docker", "--host", f"unix://{DOCKER_SOCKET}", *args],
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}, **kwargs,
    )


class PreviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        socket = os.lstat(DOCKER_SOCKET)
        if not stat.S_ISSOCK(socket.st_mode) or socket.st_uid != 0:
            raise RuntimeError("a root-owned local Docker socket is required")
        cls.container = "sunrise-option-preview-" + uuid.uuid4().hex[:12]
        docker([
            "run", "--rm", "-d", "--name", cls.container, "--network", "none", "--pull", "never",
            "--tmpfs", "/var/lib/postgresql/data:rw,size=96m", "--tmpfs", "/var/run/postgresql:rw,size=4m",
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine",
        ], check=True, capture_output=True, text=True)
        try:
            for _ in range(60):
                # The image briefly starts an initdb-only server. Wait until
                # the entrypoint has exec'd the final postgres process (PID 1).
                process = docker(["exec", cls.container, "cat", "/proc/1/comm"], capture_output=True, text=True)
                check = docker(["exec", cls.container, "pg_isready", "-U", "postgres"], capture_output=True, text=True)
                if process.returncode == 0 and process.stdout.strip() == "postgres" and check.returncode == 0:
                    return
                time.sleep(0.25)
            raise RuntimeError("isolated PostgreSQL did not become ready")
        except BaseException:
            docker(["rm", "-f", cls.container], capture_output=True, check=False)
            raise

    @classmethod
    def tearDownClass(cls):
        docker(["rm", "-f", cls.container], capture_output=True, check=False)

    def run_preview(self, migrated, run_migration=False):
        column = ", set_id uuid, set_option_id uuid" if migrated else ""
        set_id = "00000000-0000-0000-0000-000000000001"
        already_merged = f"INSERT INTO menu_item_options VALUES (7,'4','溫度','冷',0,0,'{set_id}',NULL), (8,'4','溫度','冷',0,1,'{set_id}',NULL), (11,'1','溫度','附加',0,2,'{set_id}',NULL);" if migrated else ""
        empty_set = ",NULL,NULL" if migrated else ""
        # These are isolated temporary tables, so the original migration block
        # runs against synthetic data only; no network or persistent DB exists.
        migration_output = f"""
CREATE TEMP TABLE menu_option_sets (id uuid DEFAULT gen_random_uuid(), branch_id text, name text, min_select integer, max_select integer, display_order integer);
CREATE TEMP TABLE menu_option_set_options (id uuid DEFAULT gen_random_uuid(), set_id uuid, name text, price_delta numeric, display_order integer);
CREATE TEMP TABLE menu_option_set_items (set_id uuid, item_id text);
{MERGE_SQL}
SELECT 'MIG', b.name, s.name,
       (SELECT string_agg(o.name || CASE WHEN o.price_delta <> 0 THEN '(' || CASE WHEN o.price_delta > 0 THEN '+' ELSE '' END || o.price_delta::text || ')' ELSE '' END, '、' ORDER BY o.display_order) FROM menu_option_set_options o WHERE o.set_id = s.id),
       (SELECT count(*) FROM menu_option_set_items si WHERE si.set_id = s.id),
       (SELECT string_agg(mi.name, '、' ORDER BY mi.name) FROM menu_option_set_items si JOIN menu_items mi ON mi.id = si.item_id WHERE si.set_id = s.id),
       s.branch_id,
       (SELECT jsonb_agg(jsonb_build_object('id', mi.id, 'name', mi.name) ORDER BY mi.id::text) FROM menu_option_set_items si JOIN menu_items mi ON mi.id = si.item_id WHERE si.set_id = s.id)
  FROM menu_option_sets s JOIN branches b ON b.id = s.branch_id;
""" if run_migration else ""
        sql = f"""
BEGIN;
CREATE TEMP TABLE branches (id text PRIMARY KEY, name text);
CREATE TEMP TABLE menu_items (id text PRIMARY KEY, name text, branch_id text);
CREATE TEMP TABLE menu_item_options (id integer, item_id text, option_group text, option_name text, price_delta numeric, display_order integer{column});
INSERT INTO branches VALUES ('b','大安'),('b2','西店'),('b3','大安');
INSERT INTO menu_items VALUES ('1','甲','b'),('2','乙','b'),('3','丙','b'),('4','丁','b'),('5','戊','b'),('6','己','b2'),('7','庚','b'),('8','辛','b'),('9','壬','b'),('10','癸','b'),('11','甲','b3'),('12','甲','b');
INSERT INTO menu_item_options VALUES
 (1,'1','溫度','冰',0,1{empty_set}), (2,'1','溫度','熱',0,0{empty_set}),
 (3,'2','溫度','冰',0,0{empty_set}), (4,'2','溫度','熱',0,1{empty_set}),
 (5,'3','糖','甜',0,0{empty_set}), (6,'3','糖','甜',0,1{empty_set}),
 (9,'5','溫度','常溫',0,0{empty_set}), (10,'6','溫度','冷',0,0{empty_set}),
 (12,'7','杯型','大杯',15.50,0{empty_set}), (13,'8','杯型','小杯',-2.5,0{empty_set}),
 (14,'9','甜點','加大',1.0,0{empty_set}), (15,'10','甜點','加大',1.00,0{empty_set}),
 (16,'11','溫度','冰',0,1{empty_set}), (17,'11','溫度','熱',0,0{empty_set}),
 (18,'11','糖','甜',0,0{empty_set}), (19,'11','糖','甜',0,1{empty_set}),
 (20,'12','溫度','冰',0,1{empty_set}), (21,'12','溫度','熱',0,0{empty_set});
{already_merged}
{PREVIEW}
{migration_output}
ROLLBACK;
"""
        result = docker([
            "exec", "-i", self.container, "psql", "-X", "-q", "-A", "-t", "-F", "|",
            "-v", "ON_ERROR_STOP=1", "-U", "postgres", "postgres",
        ], input=sql, capture_output=True, text=True, check=True)
        return [line for line in result.stdout.splitlines() if line]

    def assert_expected_preview(self, lines):
        self.assertEqual(len(lines), 10)
        fields = next(line.split("|") for line in lines if line.startswith("大安|溫度|1|") and line.split("|")[6] == "b")
        self.assertEqual(fields[:5], ["大安", "溫度", "1", "熱、冰", "3"])
        # Branch-name ordering follows the actual database collation.
        self.assertEqual(set(fields[5].split("、")), {"甲", "乙"})
        self.assertEqual(json.loads(fields[7]), [{"id": "1", "name": "甲"}, {"id": "12", "name": "甲"}, {"id": "2", "name": "乙"}])
        other_branch = next(line.split("|") for line in lines if line.startswith("大安|溫度|1|") and line.split("|")[6] == "b3")
        self.assertEqual(json.loads(other_branch[7]), [{"id": "11", "name": "甲"}])
        self.assertTrue(any(line.startswith("大安|溫度|2|常溫|1|戊|b|") for line in lines))
        self.assertTrue(any(line.startswith("西店|溫度|1|冷|1|己|b2|") for line in lines))
        self.assertIn("丙|糖|b|3", lines)
        self.assertIn("甲|糖|b3|11", lines)
        cups = [line.split("|") for line in lines if line.startswith("大安|杯型|")]
        self.assertEqual(len(cups), 2)
        self.assertEqual({entry[2] for entry in cups}, {"1", "2"})
        self.assertEqual({(entry[3], entry[5]) for entry in cups}, {("大杯(+15.50)", "庚"), ("小杯(-2.5)", "辛")})
        precision = [line.split("|") for line in lines if line.startswith("大安|甜點|")]
        self.assertEqual(len(precision), 2)
        self.assertEqual({entry[2] for entry in precision}, {"1", "2"})
        self.assertEqual({(entry[3], entry[5]) for entry in precision}, {("加大(+1.0)", "壬"), ("加大(+1.00)", "癸")})

    def test_before_migration_without_set_id_column(self):
        self.assert_expected_preview(self.run_preview(False))

    def test_after_migration_skips_merged_duplicates(self):
        self.assert_expected_preview(self.run_preview(True))

    def test_preview_matches_actual_migration_for_synthetic_mixed_rows(self):
        lines = self.run_preview(True, run_migration=True)
        preview = [line for line in lines if not line.startswith("MIG|")]
        actual = [line for line in lines if line.startswith("MIG|")]
        self.assert_expected_preview(preview)
        self.assertEqual(len(actual), 8)
        for preview_line in preview:
            parts = preview_line.split("|")
            if len(parts) != 8:  # duplicate-name rows are deliberately unmerged
                continue
            branch, group, number, choices, count, item_names, branch_id, item_details = parts
            name = group if number == "1" else f"{group} ({number})"
            actual_line = next(line for line in actual if line.startswith(f"MIG|{branch}|{name}|") and line.split("|")[6] == branch_id)
            result = actual_line.split("|")
            self.assertEqual(result[3:5], [choices, count])
            self.assertEqual(set(result[5].split("、")), set(item_names.split("、")))
            self.assertEqual(json.loads(result[7]), json.loads(item_details))


if __name__ == "__main__":
    unittest.main()
