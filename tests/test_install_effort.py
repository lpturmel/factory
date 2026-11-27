"""Tests for the optional `efforts` answer in skills/factory-onboard/install.py.

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
INSTALL = REPO / "skills" / "factory-onboard" / "install.py"
TEMPLATES = REPO / "templates"


def answers(**extra):
    a = {
        "name": "demo",
        "backlog": "local",
        "github_repo": None,
        "merge": "local",
        "reviewers": [{"name": "code-reviewer", "purpose": "Correctness.", "model": "sonnet", "when": "always"}],
        "checks": ["true"],
    }
    a.update(extra)
    return a


class InstallEffortTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="factory-install-"))
        self.home = self.tmp / "claude-home"
        self.home.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def install(self, a, name="proj"):
        project = self.tmp / name
        project.mkdir()
        f = self.tmp / (name + "-answers.json")
        f.write_text(json.dumps(a))
        env = dict(os.environ, CLAUDE_CONFIG_DIR=str(self.home))
        p = subprocess.run([sys.executable, str(INSTALL), "--project", str(project), "--answers", str(f),
                            "--templates", str(TEMPLATES)],
                           env=env, text=True, capture_output=True, stdin=subprocess.DEVNULL)
        return p, project

    def config(self, project):
        return json.loads((project / "factory" / "config.json").read_text())

    def test_no_efforts_writes_no_efforts_key(self):
        p, project = self.install(answers())
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("efforts", self.config(project)["models"])

    def test_empty_efforts_same_config_as_none(self):
        p1, plain = self.install(answers(), "plain")
        p2, empty = self.install(answers(efforts={}), "empty")
        self.assertEqual(p1.returncode, 0, p1.stdout)
        self.assertEqual(p2.returncode, 0, p2.stdout)
        self.assertEqual((plain / "factory" / "config.json").read_text(),
                         (empty / "factory" / "config.json").read_text())

    def test_valid_efforts_written(self):
        p, project = self.install(answers(efforts={"code-reviewer": "low", "builder": "xhigh"}))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.config(project)["models"]["efforts"], {"code-reviewer": "low", "builder": "xhigh"})

    def assert_error(self, efforts, contains):
        p, project = self.install(answers(efforts=efforts))
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertTrue(p.stdout.strip().splitlines()[-1].startswith("ERROR "), p.stdout)
        self.assertIn(contains, p.stdout)
        self.assertEqual(list(project.iterdir()), [], "nothing may be written")

    def test_invalid_value(self):
        self.assert_error({"builder": "turbo"}, "low, medium, high, xhigh, max")

    def test_null_value(self):
        self.assert_error({"builder": None}, '"builder"')

    def test_unknown_agent(self):
        self.assert_error({"ux-reviewer": "low"}, '"ux-reviewer"')

    def test_not_an_object(self):
        self.assert_error(["low"], "efforts must be an object")


if __name__ == "__main__":
    unittest.main()
