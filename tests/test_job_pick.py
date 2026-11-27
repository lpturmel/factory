"""Tests for `factory/bin/job pick` (template copy) and the approve guard.

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


def job_fixture(jid, ref, stage):
    return {
        "version": 1,
        "id": jid,
        "title": "fixture " + jid,
        "stage": stage,
        "waiting_on": "human" if stage == "needs-human" else None,
        "note": stage,
        "issue": {"source": "local", "ref": ref, "url": None,
                  "file": "factory/backlog/%s.md" % ref, "author": None},
        "risk": "low",
        "surfaces": [],
        "models": {"intake": "fable", "spec-writer": "opus", "builder": "opus", "approver": "opus"},
        "reviewers": [],
        "round": 1,
        "max_rounds": 4,
        "branch": None,
        "worktree": None,
        "base": "origin/main",
        "pr": None,
        "verdicts": {"intake": "ACCEPT", "gate": {}, "review": {}, "approve": {}, "merge_gate": {}},
        "issue_hash": None,
        "cost": None,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "stage_entered_at": "2026-01-01T00:00:00Z",
        "history": [{"stage": stage, "at": "2026-01-01T00:00:00Z", "round": 1, "note": ""}],
    }


class PickTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="factory-pick-"))
        self.factory = self.tmp / "factory"
        self.jobs = self.factory / "jobs"
        self.backlog = self.factory / "backlog"
        self.jobs.mkdir(parents=True)
        self.backlog.mkdir(parents=True)
        (self.factory / "config.json").write_text(json.dumps({"backlog": "local", "concurrency": 1}))
        self.add_backlog("ready-one", "ready")
        self.add_backlog("busy-ref", "ready")
        self.add_backlog("done-ref", "done")
        self.add_backlog("draft-ref", "draft")
        # concurrency 1 is already used by this open job
        self.add_job(job_fixture("local-busy-ref", "busy-ref", "build"))
        self.add_job(job_fixture("local-done-ref", "done-ref", "merged"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add_backlog(self, ref, status):
        (self.backlog / (ref + ".md")).write_text(
            "---\ntitle: %s\nstatus: %s\n---\n\nBody of %s.\n" % (ref, status, ref))

    def add_job(self, job):
        d = self.jobs / job["id"]
        d.mkdir(parents=True)
        (d / "job.json").write_text(json.dumps(job, indent=2) + "\n")

    def run_job(self, *args):
        env = dict(os.environ, FACTORY_ROOT=str(self.tmp))
        return subprocess.run([sys.executable, str(JOB)] + list(args), cwd=str(self.tmp), env=env,
                              text=True, capture_output=True, stdin=subprocess.DEVNULL)

    def snapshot(self):
        return {str(p.relative_to(self.jobs)): p.read_bytes()
                for p in sorted(self.jobs.rglob("*")) if p.is_file()}

    def assert_refused(self, arg, contains):
        before = self.snapshot()
        p = self.run_job("pick", arg)
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        lines = p.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, p.stdout)
        self.assertTrue(lines[0].startswith("ERROR "), p.stdout)
        self.assertIn(contains, lines[0])
        self.assertEqual(self.snapshot(), before)

    def test_pick_open_job_by_id(self):
        before = self.snapshot()
        p = self.run_job("pick", "local-busy-ref")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "local-busy-ref build")
        self.assertEqual(self.snapshot(), before)

    def test_pick_open_job_by_ref(self):
        before = self.snapshot()
        p = self.run_job("pick", "busy-ref")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "local-busy-ref build")
        self.assertEqual(self.snapshot(), before)

    def test_pick_ready_ref_creates_job_despite_full_concurrency(self):
        p = self.run_job("pick", "ready-one")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "local-ready-one intake")
        job = json.loads((self.jobs / "local-ready-one" / "job.json").read_text())
        self.assertEqual(job["stage"], "intake")
        self.assertEqual(job["issue"]["ref"], "ready-one")
        self.assertTrue((self.jobs / "local-ready-one" / "issue.md").exists())
        # picking it again resolves the same job instead of creating another
        p = self.run_job("pick", "ready-one")
        self.assertEqual(p.stdout.strip(), "local-ready-one intake")
        self.assertFalse((self.jobs / "local-ready-one-2").exists())

    def test_pick_terminal_job_id(self):
        self.assert_refused("local-done-ref", "local-done-ref is already merged")

    def test_pick_ref_whose_only_job_is_terminal(self):
        self.assert_refused("done-ref", "local-done-ref is already merged")

    def test_pick_unknown_ref(self):
        self.assert_refused("nope", "no job or ready backlog item for nope")

    def test_pick_backlog_item_not_ready(self):
        self.assert_refused("draft-ref", "no job or ready backlog item for draft-ref")
        self.assertFalse((self.jobs / "local-draft-ref").exists())

    def test_pick_bad_args(self):
        for arg in ("../x", "a b", "", "x;y", "a/b"):
            with self.subTest(arg=arg):
                self.assert_refused(arg, "bad id or ref")

    def test_approve_refuses_job_not_needs_human(self):
        path = self.jobs / "local-busy-ref" / "job.json"
        before = path.read_bytes()
        p = self.run_job("approve", "local-busy-ref")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertTrue(p.stdout.strip().startswith("ERROR "), p.stdout)
        self.assertIn("not needs-human", p.stdout)
        self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
