"""Tests for the main-checkout guard on `factory/bin/job sync` (template copy).

Run from the repo root: python3 -m unittest discover -s tests
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
JOB = REPO / "templates" / "factory" / "bin" / "job"


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=factory-test", "-c", "user.email=test@example.invalid",
                    "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"] + list(args),
                   cwd=str(cwd), env=clean_env(), check=True, capture_output=True, text=True,
                   stdin=subprocess.DEVNULL)


class SyncGuardTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="factory-sync-"))
        self.root = self.base / "project"
        self.root.mkdir()
        git(self.root, "init", "-q")
        git(self.root, "commit", "-q", "--allow-empty", "-m", "init")
        self.factory = self.root / "factory"
        self.jobs = self.factory / "jobs"
        self.backlog = self.factory / "backlog"
        self.jobs.mkdir(parents=True)
        self.backlog.mkdir(parents=True)
        (self.factory / "config.json").write_text(json.dumps({"backlog": "local", "concurrency": 1}))
        (self.backlog / "ready-one.md").write_text(
            "---\ntitle: ready-one\nstatus: ready\n---\n\nBody.\n")

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def run_sync(self, cwd, factory_root=None):
        env = clean_env(FACTORY_ROOT=str(factory_root or self.root))
        return subprocess.run([sys.executable, str(JOB), "sync"], cwd=str(cwd), env=env,
                              text=True, capture_output=True, stdin=subprocess.DEVNULL)

    def snapshot(self):
        return {str(p.relative_to(self.factory)): p.read_bytes()
                for p in sorted(self.factory.rglob("*")) if p.is_file()}

    def expected_error(self, cwd):
        return ("ERROR run /factory from %s (this session is in %s); "
                "project permissions only apply there" % (self.root.resolve(), Path(cwd).resolve()))

    def assert_starts_job(self, cwd, factory_root=None):
        p = self.run_sync(cwd, factory_root)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "local-ready-one intake")
        self.assertTrue((self.jobs / "local-ready-one" / "job.json").exists())

    def assert_refused(self, cwd):
        before = self.snapshot()
        p = self.run_sync(cwd)
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertEqual(p.stdout.splitlines(), [self.expected_error(cwd)], p.stdout)
        self.assertNotIn("Traceback", p.stdout + p.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.jobs / "local-ready-one").exists())

    def test_root_starts_job(self):
        self.assert_starts_job(self.root)

    def test_subdirectory_starts_job(self):
        sub = self.root / "src" / "deep"
        sub.mkdir(parents=True)
        self.assert_starts_job(sub)

    def test_linked_worktree_inside_root_refused(self):
        wt = self.root / ".claude" / "worktrees" / "x"
        git(self.root, "worktree", "add", "-q", "--detach", str(wt))
        self.assert_refused(wt)

    def test_job_worktree_refused(self):
        wt = self.root / "factory" / "worktrees" / "local-x"
        git(self.root, "worktree", "add", "-q", "--detach", str(wt))
        self.assert_refused(wt)

    def test_sibling_worktree_refused(self):
        wt = self.base / "sibling"
        git(self.root, "worktree", "add", "-q", "--detach", str(wt))
        self.assert_refused(wt)
        sub = wt / "sub"
        sub.mkdir()
        self.assert_refused(sub)

    def test_unrelated_repo_refused(self):
        other = self.base / "other"
        other.mkdir()
        git(other, "init", "-q")
        self.assert_refused(other)

    def test_non_repo_refused(self):
        plain = Path(tempfile.mkdtemp(prefix="factory-sync-plain-"))
        self.addCleanup(shutil.rmtree, plain, True)
        self.assert_refused(plain)

    def test_root_not_a_repo_refused(self):
        shutil.rmtree(self.root / ".git")
        self.assert_refused(self.root)

    def test_symlinked_root_and_cwd_start_job(self):
        link = self.base / "link"
        link.symlink_to(self.root, target_is_directory=True)
        self.assert_starts_job(link, factory_root=link)


if __name__ == "__main__":
    unittest.main()
