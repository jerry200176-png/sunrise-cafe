#!/usr/bin/env python3
"""Self-check for prepush_guard.py: python3 -B .claude/hooks/test_prepush_guard.py (no dependencies)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    tmp = os.path.realpath(tempfile.mkdtemp(prefix="prepush-guard-test-"))
    other = os.path.realpath(tempfile.mkdtemp(prefix="prepush-guard-other-"))
    fails = []
    try:
        git = lambda repo, *a: subprocess.run(["git", "-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=T", *a],
                                              check=True, capture_output=True)
        for repo in (tmp, other):
            git(repo, "init", "-q", "-b", "feature/x")
            os.makedirs(os.path.join(repo, "scripts"))
        with open(os.path.join(tmp, ".git", "info", "exclude"), "a") as fh:
            fh.write(".claude/\n")
        shutil.copytree(HERE, os.path.join(tmp, ".claude", "hooks"), ignore=shutil.ignore_patterns("__pycache__"))
        hook = os.path.join(tmp, ".claude", "hooks", "prepush_guard.py")
        ran = os.path.join(other, "ran")
        marker = f"touch {ran}\nexit 1\n"

        def commit(repo, body, merged=True, extra=None):
            with open(os.path.join(repo, "scripts", "agent-prepush.sh"), "w") as fh:
                fh.write(body)
            git(repo, "add", "-A", "scripts")
            if extra:
                git(repo, "add", "-f", extra)
            git(repo, "commit", "-q", "--allow-empty", "-m", "x")
            if merged:  # "already on main": only then may the hook run it
                git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")

        def case(name, cmd, want, cwd=tmp):
            o = subprocess.run([sys.executable, "-I", hook], input=json.dumps({"tool_input": {"command": cmd}}),
                               capture_output=True, text=True, cwd=cwd, timeout=30).stdout
            got = ("TICKS" if "unquoted heredoc" in o else "PREPUSH" if "pre-push checks failed" in o
                   else "SKIP" if "pre-push checks not run" in o else "ALLOW" if not o.strip() else "?")
            if got != want:
                fails.append(f"{name}: expected {want}, got {got}: {o[:300]}")

        push = "git push -u origin feature/x"
        commit(other, marker)
        case("other checkout is never run", push, "ALLOW", cwd=other)
        commit(tmp, "echo 'FAIL  x'\nexit 1\n")
        case("failing list denies the push", push, "PREPUSH")
        case("chained after cd", "cd . && git push", "PREPUSH")
        case("global option before push", "git -C . push origin feature/x", "PREPUSH")
        for cmd in ("git stash push -m wip", "git checkout -b fix/push-x", "git log --grep push"):
            case("not a push: " + cmd, cmd, "ALLOW")
        case("dry run", "git push --dry-run origin feature/x", "ALLOW")
        case("push only inside a commit message", "git commit --allow-empty -m 'then git push origin x'", "ALLOW")
        case("not a push", "git status", "ALLOW")
        case("skip switch", "SKIP_PREPUSH=1 " + push, "SKIP")
        if len(open(os.path.join(tmp, ".git", "agent-prepush-skips.log")).read().splitlines()) != 1:
            fails.append("skip switch must add one line to .git/agent-prepush-skips.log")
        commit(tmp, "exit 0\n")
        case("passing list allows", push, "ALLOW")
        # From here the committed list would leave a marker file if it ran.
        commit(tmp, marker)
        open(os.path.join(tmp, "new.txt"), "w").close()
        case("untracked file", push, "SKIP")
        case("commit and push in one command", "git add -A && git commit -m x && git push", "SKIP")
        os.remove(os.path.join(tmp, "new.txt"))
        commit(tmp, marker + "# branch edit\n", merged=False)
        case("list changed on the branch only", push, "SKIP")
        os.makedirs(os.path.join(tmp, "src"))
        case("branch-only list, session in a subfolder", push, "SKIP", cwd=os.path.join(tmp, "src"))
        case("skip switch from a subfolder", "SKIP_PREPUSH=1 " + push, "SKIP", cwd=os.path.join(tmp, "src"))
        if len(open(os.path.join(tmp, ".git", "agent-prepush-skips.log")).read().splitlines()) != 2:
            fails.append("skip switch from a subfolder must add a line to .git/agent-prepush-skips.log")
        commit(tmp, marker)
        git(tmp, "update-ref", "-d", "refs/remotes/origin/main")
        case("no origin/main", push, "SKIP")
        git(tmp, "update-ref", "refs/remotes/origin/main", "HEAD")
        os.makedirs(os.path.join(tmp, "docs"))
        os.symlink("docs", os.path.join(tmp, "node_modules"))
        commit(tmp, marker, merged=False, extra="node_modules")
        case("node_modules committed as a symlink", push, "SKIP")
        if os.path.exists(ran):
            fails.append("a list that is foreign, uncommitted or branch-only was executed")
        case("backticks in an unquoted heredoc", 'gh pr create --body "$(cat <<EOF\nruns `npm test`\nEOF\n)"', "TICKS")
        case("quoted heredoc", "gh pr create --body \"$(cat <<'EOF'\nruns `npm test`\nEOF\n)\"", "ALLOW")
        case("backtick after the heredoc", "cat <<EOF\nplain\nEOF\necho '`x`'", "ALLOW")
        case("escaped backtick", "cat <<EOF\nan \\`escaped\\` one\nEOF", "ALLOW")
        case("tab-stripped heredoc", "cat <<-EOF\n\tsee `x`\n\tEOF", "TICKS")
        case("shift inside a quoted heredoc", "cat > x.ts <<'EOF'\nconst a = 1 << bits\nconst s = `t`\nEOF", "ALLOW")
        case("here-string and arithmetic", "cat <<<word\necho $((1<<n))\necho '`x`'", "ALLOW")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(other, ignore_errors=True)
    print("\n".join(fails) or "OK: prepush_guard")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
