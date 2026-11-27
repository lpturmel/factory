"""Tests for per-agent reasoning effort (config models.efforts) in `factory/bin/job`.

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

REVIEWERS = [
    {"name": "code-reviewer", "model": "sonnet", "model_id": "claude-sonnet-5-5"},
    {"name": "ui-reviewer", "model": "haiku", "model_id": "claude-haiku-5-5"},
]


def job_fixture(jid, stage, reviewers=()):
    return {
        "version": 1,
        "id": jid,
        "title": "fixture " + jid,
        "stage": stage,
        "waiting_on": None,
        "note": stage,
        "issue": {"source": "local", "ref": jid, "url": None,
                  "file": "factory/backlog/%s.md" % jid, "author": None},
        "risk": "low",
        "surfaces": [],
        "models": {"intake": "fable", "spec-writer": "opus", "builder": "opus", "approver": "opus"},
        "reviewers": list(reviewers),
        "round": 1,
        "max_rounds": 4,
        "branch": None,
        "worktree": None,
        "base": "main",
        "pr": None,
        "verdicts": {"intake": "ACCEPT", "gate": {"1": "PASS"}, "review": {"1": {}},
                     "approve": {}, "merge_gate": {}},
        "issue_hash": None,
        "cost": None,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "stage_entered_at": "2026-01-01T00:00:00Z",
        "history": [{"stage": stage, "at": "2026-01-01T00:00:00Z", "round": 1, "note": ""}],
    }


class EffortTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="factory-effort-"))
        self.home = self.tmp / "claude-home"  # no transcripts: cost scanning finds nothing
        self.home.mkdir()
        self.factory = self.tmp / "factory"
        self.jobs = self.factory / "jobs"
        self.jobs.mkdir(parents=True)
        (self.factory / "backlog").mkdir()
        self.write_config(None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_config(self, efforts, raw=False):
        models = {"agents": {"intake": "fable", "spec-writer": "opus", "builder": "opus", "approver": "opus"}}
        if raw or efforts is not None:
            models["efforts"] = efforts
        cfg = {"backlog": "local", "merge": "local", "models": models,
               "reviewers": [{"name": "code-reviewer", "model": "sonnet", "when": "always"},
                             {"name": "ui-reviewer", "model": "haiku", "when": "ui"}]}
        (self.factory / "config.json").write_text(json.dumps(cfg))

    def add_job(self, job):
        d = self.jobs / job["id"]
        d.mkdir(parents=True)
        (d / "job.json").write_text(json.dumps(job, indent=2) + "\n")

    def job(self, jid):
        return json.loads((self.jobs / jid / "job.json").read_text())

    def run_job(self, *args, stdin=None):
        env = dict(os.environ, FACTORY_ROOT=str(self.tmp), CLAUDE_CONFIG_DIR=str(self.home))
        return subprocess.run([sys.executable, str(JOB)] + list(args), cwd=str(self.tmp), env=env,
                              text=True, capture_output=True,
                              input=stdin, stdin=None if stdin is not None else subprocess.DEVNULL)

    def snapshot(self):
        return {str(p.relative_to(self.jobs)): p.read_bytes()
                for p in sorted(self.jobs.rglob("*")) if p.is_file()}

    def next_line(self, jid):
        p = self.run_job("next", jid)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        lines = p.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, p.stdout)
        return lines[0]

    # ---- no efforts: unchanged behaviour ----

    def test_no_efforts_spawn_line_unchanged(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.assertEqual(self.next_line("local-a"), "local-a spec SPAWN spec-writer:opus out=spec.md")
        self.assertNotIn("efforts", self.job("local-a"))

    def test_empty_efforts_map_spawn_line_unchanged(self):
        self.write_config({})
        self.add_job(job_fixture("local-a", "intake"))
        self.assertEqual(self.next_line("local-a"), "local-a intake SPAWN intake:fable out=intake.md")
        self.assertNotIn("efforts", self.job("local-a"))

    def test_no_efforts_review_line_unchanged(self):
        self.add_job(job_fixture("local-a", "review", REVIEWERS))
        self.assertEqual(self.next_line("local-a"),
                         "local-a review SPAWN code-reviewer:sonnet ui-reviewer:haiku "
                         "out=review-1-code-reviewer.md,review-1-ui-reviewer.md")
        self.assertNotIn("efforts", self.job("local-a"))

    # ---- efforts configured ----

    def test_effort_for_spawned_agent(self):
        self.write_config({"spec-writer": "high"})
        self.add_job(job_fixture("local-a", "spec"))
        line = self.next_line("local-a")
        self.assertEqual(line, "local-a spec SPAWN spec-writer:opus:high out=spec.md")
        self.assertEqual(self.job("local-a")["efforts"], {"spec-writer": "high"})

    def test_effort_for_one_of_two_reviewers(self):
        self.write_config({"code-reviewer": "low"})
        self.add_job(job_fixture("local-a", "review", REVIEWERS))
        self.assertEqual(self.next_line("local-a"),
                         "local-a review SPAWN code-reviewer:sonnet:low ui-reviewer:haiku "
                         "out=review-1-code-reviewer.md,review-1-ui-reviewer.md")
        self.assertEqual(self.job("local-a")["efforts"], {"code-reviewer": "low"})

    def test_effort_removed_from_config_drops_key_on_respawn(self):
        self.write_config({"spec-writer": "max", "builder": "high"})
        self.add_job(job_fixture("local-a", "spec"))
        self.assertIn("spec-writer:opus:max", self.next_line("local-a"))
        self.assertEqual(self.job("local-a")["efforts"], {"spec-writer": "max"})
        self.write_config({"builder": "high"})
        # spec.md still missing: next respawns the spec writer, now at its default effort
        self.assertEqual(self.next_line("local-a"), "local-a spec SPAWN spec-writer:opus out=spec.md")
        self.assertNotIn("efforts", self.job("local-a"))

    def test_effort_dropped_for_one_agent_keeps_others(self):
        self.write_config({"code-reviewer": "low", "ui-reviewer": "medium"})
        self.add_job(job_fixture("local-a", "review", REVIEWERS))
        self.next_line("local-a")
        self.assertEqual(self.job("local-a")["efforts"], {"code-reviewer": "low", "ui-reviewer": "medium"})
        self.write_config({"code-reviewer": "xhigh"})
        self.assertEqual(self.next_line("local-a"),
                         "local-a review SPAWN code-reviewer:sonnet:xhigh ui-reviewer:haiku "
                         "out=review-1-code-reviewer.md,review-1-ui-reviewer.md")
        self.assertEqual(self.job("local-a")["efforts"], {"code-reviewer": "xhigh"})

    def test_old_job_without_efforts_field(self):
        self.write_config({"intake": "medium"})
        job = job_fixture("local-a", "intake")
        self.assertNotIn("efforts", job)
        self.add_job(job)
        self.assertEqual(self.next_line("local-a"), "local-a intake SPAWN intake:fable:medium out=intake.md")
        self.assertEqual(self.job("local-a")["efforts"], {"intake": "medium"})

    def test_feedback_spawns_builder_with_effort(self):
        self.write_config({"builder": "high"})
        self.add_job(job_fixture("local-a", "review", REVIEWERS))
        p = self.run_job("feedback", "local-a", stdin="please rename it\n")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "local-a build SPAWN builder:opus:high out=build-2.md")
        self.assertEqual(self.job("local-a")["efforts"], {"builder": "high"})

    # ---- invalid map: ERROR, nothing changes ----

    def assert_refused(self, cmd, efforts, contains, stdin=None):
        self.write_config(efforts, raw=True)
        before = self.snapshot()
        p = self.run_job(cmd, "local-a", stdin=stdin)
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        lines = p.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1, p.stdout)
        self.assertTrue(lines[0].startswith("ERROR "), p.stdout)
        self.assertNotIn("SPAWN", p.stdout)
        self.assertIn(contains, lines[0])
        self.assertIn("low, medium, high, xhigh, max", lines[0])
        self.assertEqual(self.snapshot(), before)

    def test_invalid_value(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.assert_refused("next", {"spec-writer": "turbo"}, '"spec-writer"')

    def test_wrong_case_value(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.assert_refused("next", {"spec-writer": "High"}, '"High"')

    def test_null_and_empty_values(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.assert_refused("next", {"builder": None}, '"builder"')
        self.assert_refused("next", {"builder": ""}, '"builder"')

    def test_unknown_agent_key(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.assert_refused("next", {"code-reveiwer": "low"}, '"code-reveiwer"')

    def test_not_an_object(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.assert_refused("next", ["low"], "models.efforts")
        self.assert_refused("next", "low", "models.efforts")

    def test_long_value_is_cut(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.write_config({"builder": "x" * 500}, raw=True)
        p = self.run_job("next", "local-a")
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertNotIn("x" * 41, p.stdout)

    def test_invalid_map_refuses_feedback_approve_merge(self):
        self.add_job(job_fixture("local-a", "review", REVIEWERS))
        self.assert_refused("feedback", {"builder": "turbo"}, '"builder"', stdin="change it\n")
        self.assert_refused("approve", {"builder": "turbo"}, '"builder"')
        self.assert_refused("merge", {"builder": "turbo"}, '"builder"')

    def test_invalid_map_does_not_break_read_commands(self):
        self.add_job(job_fixture("local-a", "spec"))
        self.write_config({"nobody": "turbo"}, raw=True)
        p = self.run_job("list")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), "local-a spec r1 spec")
        p = self.run_job("show", "local-a", "stage")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.strip(), '"spec"')


if __name__ == "__main__":
    unittest.main()
