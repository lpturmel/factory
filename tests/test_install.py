"""Tests for skills/factory-onboard/install.py model stamping and the agent ERROR rule.

Run from the repo root: python3 -m unittest discover -s tests
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INSTALL = REPO / "skills" / "factory-onboard" / "install.py"
TEMPLATES = REPO / "templates"
AGENTS = TEMPLATES / ".claude" / "agents"
FIXED = ["intake", "spec-writer", "builder", "approver"]


def load_install():
    spec = importlib.util.spec_from_file_location("factory_install", str(INSTALL))
    mod = importlib.util.module_from_spec(spec)
    old = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = old
    return mod


install = load_install()
REVIEWER_TMPL = (AGENTS / "reviewer.md").read_text()


def frontmatter(text):
    """Return the frontmatter lines between the leading and closing `---`."""
    lines = text.split("\n")
    if lines[0] != "---":
        return None
    try:
        end = lines.index("---", 1)
    except ValueError:
        return None
    return lines[1:end]


class StampReviewerTest(unittest.TestCase):
    def reviewer(self, model):
        return {"name": "code-reviewer", "purpose": "Check the diff", "model": model, "when": "always"}

    def test_dict_model_drops_model_line(self):
        out = install.stamp_reviewer(REVIEWER_TMPL, self.reviewer(
            {"low": "haiku", "medium": "sonnet", "high": "sonnet"}))
        fm = frontmatter(out)
        self.assertIsNotNone(fm)
        self.assertFalse(any(l.startswith("model:") for l in fm), fm)
        self.assertNotIn("", fm)
        self.assertNotIn("{{", out)

    def test_string_model_is_stamped(self):
        out = install.stamp_reviewer(REVIEWER_TMPL, self.reviewer("haiku"))
        fm = frontmatter(out)
        self.assertIn("model: haiku", fm)
        self.assertNotIn("{{", out)

    def test_missing_model_defaults_to_sonnet(self):
        r = self.reviewer("x")
        del r["model"]
        self.assertIn("model: sonnet", frontmatter(install.stamp_reviewer(REVIEWER_TMPL, r)))


class StampModelTest(unittest.TestCase):
    def test_only_frontmatter_is_rewritten(self):
        text = "---\nname: a\nmodel: opus\n---\n\nmodel: opus in the body\n"
        self.assertEqual(install.stamp_model(text, "sonnet"),
                         "---\nname: a\nmodel: sonnet\n---\n\nmodel: opus in the body\n")

    def test_no_alias_keeps_text(self):
        text = "---\nmodel: opus\n---\n"
        self.assertEqual(install.stamp_model(text, None), text)


class InstallEndToEndTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="factory-install-"))
        self.project = self.tmp / "project"
        self.project.mkdir()
        self.answers = self.tmp / "answers.json"
        self.answers.write_text(json.dumps({
            "name": "demo",
            "backlog": "local",
            "merge": "local",
            "reviewers": [
                {"name": "code-reviewer", "purpose": "Correctness",
                 "model": {"low": "haiku", "medium": "sonnet", "high": "sonnet"}, "when": "always"},
                {"name": "ui-reviewer", "purpose": "Visual fit", "model": "haiku", "when": "always"},
            ],
            "checks": ["true"],
            "models": {"builder": "sonnet"},
        }))
        env = dict(os.environ, CLAUDE_CONFIG_DIR=str(self.tmp / "claude"), PYTHONDONTWRITEBYTECODE="1")
        self.run_out = subprocess.run(
            [sys.executable, str(INSTALL), "--project", str(self.project), "--answers", str(self.answers),
             "--templates", str(TEMPLATES)],
            env=env, capture_output=True, text=True)

    def tearDown(self):
        shutil.rmtree(str(self.tmp), ignore_errors=True)

    def agent(self, name):
        return (self.project / ".claude" / "agents" / ("%s.md" % name)).read_text()

    def test_install_succeeds(self):
        self.assertEqual(self.run_out.returncode, 0, self.run_out.stdout + self.run_out.stderr)

    def test_fixed_agent_models_match_config(self):
        cfg = json.loads((self.project / "factory" / "config.json").read_text())
        agents = cfg["models"]["agents"]
        self.assertEqual(agents["builder"], "sonnet")
        for name in FIXED:
            fm = frontmatter(self.agent(name))
            self.assertIn("model: %s" % agents[name], fm, name)
        self.assertIn("model: sonnet", frontmatter(self.agent("builder")))

    def test_fixed_agents_otherwise_identical(self):
        for name in FIXED:
            tmpl = (AGENTS / ("%s.md" % name)).read_text()
            strip = lambda t: re.sub(r"^model:.*$", "model:", t, count=1, flags=re.M)
            self.assertEqual(strip(self.agent(name)), strip(tmpl), name)

    def test_reviewer_models(self):
        fm = frontmatter(self.agent("code-reviewer"))
        self.assertFalse(any(l.startswith("model:") for l in fm), fm)
        self.assertIn("model: haiku", frontmatter(self.agent("ui-reviewer")))

    def test_every_agent_has_valid_frontmatter(self):
        for name in FIXED + ["code-reviewer", "ui-reviewer"]:
            text = self.agent(name)
            self.assertTrue(text.startswith("---\n"), name)
            fm = frontmatter(text)
            self.assertIsNotNone(fm, name)
            self.assertNotIn("", fm, name)
            self.assertNotIn("{{", text, name)


class AgentErrorRuleTest(unittest.TestCase):
    def test_templates_use_new_error_line(self):
        files = sorted(AGENTS.glob("*.md"))
        self.assertEqual({f.stem for f in files}, set(FIXED + ["reviewer"]))
        for f in files:
            text = f.read_text()
            self.assertRegex(text, r"`ERROR \S+ could not write <file>: <reason>`", f.name)
            self.assertIn("no tool that can write files", text, f.name)
            self.assertNotRegex(text, r"\S+ ERROR: could not write", f.name)

    def test_reviewer_prechecks_write_tool(self):
        self.assertIn("Before you start the review, check that you have a tool that can write files",
                      REVIEWER_TMPL)


if __name__ == "__main__":
    unittest.main()
