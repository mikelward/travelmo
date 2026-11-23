#!/usr/bin/env python3
"""Runs scripts/deploy-plan.sh and scripts/deploy-record.sh against real
throwaway repositories, with a stand-in `gh` on the PATH.

The Deploy job runs only on pushes to main, so this is the only coverage
its decisions get before they run for real. What matters is that a part
with pending changes is never marked deployed without being deployed: a
tag that moves too far skips those changes for good. So these assert the
plan's outputs and the tags the record step asks GitHub to move.

Standard library only. Run it directly: python3 scripts/deploy_plan_test.py
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLAN = REPO / "scripts" / "deploy-plan.sh"
RECORD = REPO / "scripts" / "deploy-record.sh"

GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.com",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}

# Every setting configured, so a due part deploys.
CONFIGURED = {
    "GCP_PROJECT": "project",
    "GCP_WORKLOAD_IDENTITY_PROVIDER": "provider",
    "GCP_DEPLOY_SERVICE_ACCOUNT": "deployer",
    "GCP_REGION": "region",
    "PARSER_IMAGE": "image",
    "CLOUDFLARE_ACCOUNT_ID": "account",
    "PARSER_URL": "https://parser.example",
    "HAS_CLOUDFLARE_TOKEN": "true",
    "SCHEDULER_SA": "scheduler",
}

PARTS = ("firestore", "parser", "worker", "scheduler")

# The stand-in gh: `gh api repos/.../commits/main` prints $FAKE_TIP (or
# fails when FAKE_TIP_FAILS is set); every call is logged to $GH_LOG, and
# a PATCH fails when FAKE_PATCH_FAILS is set, as for a tag not yet made.
FAKE_GH = """#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$*" in
  *commits/main*) [ -z "${FAKE_TIP_FAILS:-}" ] || exit 1; echo "$FAKE_TIP" ;;
  *PATCH*) [ -z "${FAKE_PATCH_FAILS:-}" ] || exit 1 ;;
esac
"""


class DeployPlanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.repo = root / "repo"
        self.repo.mkdir()
        bin_dir = root / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.gh_log = root / "gh.log"
        self.output = root / "output"
        self.path = f"{bin_dir}:{os.environ['PATH']}"
        self.git("init", "-q")
        self.base = self.commit({"README.md": "hello"})

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, check=True, capture_output=True, text=True,
            env={**os.environ, **GIT_ENV},
        ).stdout.strip()

    def commit(self, files):
        for name, text in files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")
        return self.git("rev-parse", "HEAD")

    def tag(self, part, sha):
        self.git("tag", "-f", f"deployed/{part}", sha)

    def plan(self, after, tip=None, settings=CONFIGURED, **extra):
        self.output.write_text("")
        env = {
            **os.environ, **GIT_ENV, **settings, **extra,
            "PATH": self.path, "GH_LOG": str(self.gh_log), "GITHUB_OUTPUT": str(self.output),
            "GITHUB_REPOSITORY": "owner/repo", "AFTER_SHA": after, "FAKE_TIP": tip or after,
        }
        run = subprocess.run([str(PLAN)], cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.log = run.stdout
        return dict(line.split("=", 1) for line in self.output.read_text().splitlines())

    def record(self, after, outputs, **extra):
        self.gh_log.write_text("")
        env = {
            **os.environ, **extra,
            "PATH": self.path, "GH_LOG": str(self.gh_log), "GITHUB_REPOSITORY": "owner/repo",
            "AFTER_SHA": after,
            "RECORD_FIRESTORE": outputs["record_firestore"],
            "RECORD_PARSER": outputs["record_parser"],
            "RECORD_WORKER": outputs["record_worker"],
            "RECORD_SCHEDULER": outputs.get("record_scheduler", "false"),
        }
        run = subprocess.run([str(RECORD)], cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return self.gh_log.read_text()

    def test_a_part_never_deployed_deploys_and_is_recorded(self):
        out = self.plan(self.base)
        for part in PARTS:
            self.assertEqual(out[part], "true", part)
            self.assertEqual(out[f"record_{part}"], "true", part)

    def test_a_changed_part_deploys_and_an_unchanged_one_is_only_recorded(self):
        for part in PARTS:
            self.tag(part, self.base)
        after = self.commit({"apps/parser/index.ts": "x"})
        out = self.plan(after)
        self.assertEqual((out["parser"], out["record_parser"]), ("true", "true"))
        self.assertEqual((out["firestore"], out["record_firestore"]), ("false", "true"))
        self.assertEqual((out["worker"], out["record_worker"]), ("false", "true"))
        self.assertEqual((out["scheduler"], out["record_scheduler"]), ("false", "true"))

    def test_a_changed_job_list_updates_the_scheduler_jobs(self):
        for part in PARTS:
            self.tag(part, self.base)
        after = self.commit({"deploy/scheduler.sh": "x"})
        out = self.plan(after)
        self.assertEqual((out["scheduler"], out["record_scheduler"]), ("true", "true"))
        self.assertEqual((out["parser"], out["record_parser"]), ("false", "true"))

    def test_scheduler_jobs_without_their_settings_are_skipped_with_a_notice(self):
        # Setups from before CI ran deploy/scheduler.sh lack SCHEDULER_SA;
        # they stay green, and the jobs update once it is set.
        for part in PARTS:
            self.tag(part, self.base)
        after = self.commit({"deploy/scheduler.sh": "x"})
        out = self.plan(after, settings={**CONFIGURED, "SCHEDULER_SA": ""})
        self.assertEqual((out["scheduler"], out["record_scheduler"]), ("false", "false"))
        self.assertIn("::notice::Skipping the Cloud Scheduler jobs", self.log)
        self.assertIn("SCHEDULER_SA", self.log)
        self.assertNotIn("::warning::", self.log)
        out = self.plan(after)
        self.assertEqual((out["scheduler"], out["record_scheduler"]), ("true", "true"))

    def test_scheduler_jobs_wait_for_a_due_parser_that_cannot_deploy(self):
        # A new job calls a route the parser of the same push adds.
        for part in PARTS:
            self.tag(part, self.base)
        after = self.commit({"deploy/scheduler.sh": "x", "apps/parser/index.ts": "x"})
        out = self.plan(after, settings={**CONFIGURED, "PARSER_IMAGE": ""})
        self.assertEqual((out["scheduler"], out["record_scheduler"]), ("false", "false"))

    def test_changes_since_the_tag_count_not_just_this_push(self):
        # A parser change in an earlier push whose run deployed nothing (it
        # was superseded, or failed) still deploys with a later README push.
        for part in PARTS:
            self.tag(part, self.base)
        self.commit({"apps/parser/index.ts": "x"})
        after = self.commit({"README.md": "later"})
        self.assertEqual(self.plan(after)["parser"], "true")

    def test_a_superseded_run_deploys_and_records_nothing(self):
        older = self.commit({"apps/parser/index.ts": "x"})
        newer = self.commit({"README.md": "later"})
        out = self.plan(older, tip=newer)
        self.assertTrue(all(value == "false" for value in out.values()), out)
        self.assertEqual(self.record(older, out), "")

    def test_an_unconfigured_part_is_skipped_and_keeps_its_tag(self):
        settings = {**CONFIGURED, "PARSER_URL": "", "HAS_CLOUDFLARE_TOKEN": "false"}
        out = self.plan(self.base, settings=settings)
        self.assertEqual((out["worker"], out["record_worker"]), ("false", "false"))
        self.assertIn("PARSER_URL", self.log)
        self.assertIn("CLOUDFLARE_API_TOKEN", self.log)
        self.assertEqual(out["parser"], "true")

    def test_rules_wait_for_a_due_parser_that_cannot_deploy(self):
        # The rules rely on the parser of the same push (SPEC "Access"), so
        # they never go out while it is held back.
        for part in PARTS:
            self.tag(part, self.base)
        after = self.commit({"firestore.rules": "x", "apps/parser/index.ts": "x"})
        out = self.plan(after, settings={**CONFIGURED, "PARSER_IMAGE": ""})
        self.assertEqual((out["parser"], out["record_parser"]), ("false", "false"))
        self.assertEqual((out["firestore"], out["record_firestore"]), ("false", "false"))
        self.assertIn("until the parser deploys too", self.log)
        out = self.plan(after)
        self.assertEqual((out["parser"], out["firestore"]), ("true", "true"))

    def test_rules_alone_deploy_when_the_parser_is_unchanged(self):
        for part in PARTS:
            self.tag(part, self.base)
        after = self.commit({"firestore.rules": "x"})
        out = self.plan(after, settings={**CONFIGURED, "PARSER_IMAGE": ""})
        self.assertEqual((out["firestore"], out["record_firestore"]), ("true", "true"))
        self.assertEqual((out["parser"], out["record_parser"]), ("false", "true"))

    def test_a_tag_a_force_push_left_behind_deploys_in_full(self):
        stray = self.commit({"apps/parser/index.ts": "abandoned"})
        self.git("reset", "-q", "--hard", self.base)
        after = self.commit({"README.md": "rewritten"})
        for part in PARTS:
            self.tag(part, stray)
        out = self.plan(after)
        self.assertEqual(out["firestore"], "true")
        self.assertEqual(out["worker"], "true")

    def test_a_large_diff_still_finds_the_change(self):
        # grep -q would quit at the first match, git diff would die of
        # SIGPIPE, and pipefail would read that as no change.
        for part in PARTS:
            self.tag(part, self.base)
        # The matching file sorts first, and the rest are far more than a
        # pipe's buffer, so git diff is still writing when grep could stop.
        files = {"apps/parser/a.ts": "x"}
        files.update({f"apps/parser/long/path/to/make/the/diff/big/file{i:05}.ts": "" for i in range(8000)})
        after = self.commit(files)
        out = self.plan(after)
        self.assertEqual((out["parser"], out["record_parser"]), ("true", "true"))

    def test_an_unreadable_tip_goes_on_as_if_this_push_were_it(self):
        out = self.plan(self.base, FAKE_TIP_FAILS="1")
        self.assertEqual(out["parser"], "true")

    def test_record_moves_only_the_recorded_parts(self):
        calls = self.record(self.base, {
            "record_firestore": "true", "record_parser": "false", "record_worker": "true",
            "record_scheduler": "true",
        })
        self.assertIn("refs/tags/deployed/scheduler", calls)
        self.assertIn("refs/tags/deployed/firestore", calls)
        self.assertIn("refs/tags/deployed/worker", calls)
        self.assertNotIn("deployed/parser", calls)
        self.assertIn(self.base, calls)

    def test_record_creates_a_tag_that_does_not_exist_yet(self):
        calls = self.record(self.base, {
            "record_firestore": "false", "record_parser": "true", "record_worker": "false",
        }, FAKE_PATCH_FAILS="1")
        self.assertIn("-X POST", calls)
        self.assertIn("ref=refs/tags/deployed/parser", calls)


if __name__ == "__main__":
    sys.exit(unittest.main())
