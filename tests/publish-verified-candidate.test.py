"""Synthetic end-to-end publisher checks. No credentials, network or installer execution."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("candidate_publisher", Path(__file__).resolve().parents[1] / "scripts/publish-verified-candidate.py")
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)
COMMIT = "a" * 40
TAG = "v6.1.0-rc.4"
INSTALLER = "zhike-6.1.0-win-x64-setup.exe"


def encoded(value):
    return json.dumps(value, ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


class Fixture(publisher.GitHub):
    def __init__(self):
        self.mutations = []
        self.signature_value = "NotSigned"
        self.tag = None
        self.release = None
        self.remote_assets = []
        self.history = {"id": 44, "tag_name": "v6.1.0-rc.3", "draft": False, "assets": [{"name": "unchanged"}]}
        self.source_version = "6.1.0"
        self.notes = f"# Release {TAG}\nSynthetic release notes."
        self.repository = {"id": 10, "full_name": publisher.REPO, "private": True, "permissions": {"push": True}}
        self.run = {"id": 100, "workflow_id": 20, "path": publisher.WORKFLOW, "head_sha": COMMIT,
                    "repository": {"full_name": publisher.REPO}, "head_repository": {"full_name": publisher.REPO},
                    "status": "completed", "conclusion": "success"}
        self.artifact = {"id": 200, "name": f"zhike-6.1.0-win-x64-{COMMIT}", "expired": False,
                         "workflow_run": {"id": 100, "head_sha": COMMIT, "repository_id": 10, "head_repository_id": 10}}
        installer = b"Synthetic installer bytes, never executed."
        manifest = {"version": "6.1.0", "sourceCommit": COMMIT, "releaseGate": "passed", "releaseAsset": INSTALLER,
                    "installer": "知客-6.1.0-WinUI桌面版.exe", "bytes": len(installer), "sha256": digest(installer), "signingStatus": "unsigned"}
        bundle = {"version": "6.1.0", "sourceCommit": COMMIT, "releaseGate": "passed", "sourceWorktreeDirty": False,
                  "runtime": "win-x64", "selfContained": True, "files": [
                      {"path": "Zhike.Desktop.exe", "bytes": 3, "sha256": digest(b"exe")},
                      {"path": "zhike.ico", "bytes": 3, "sha256": digest(b"ico")} ]}
        bundle_bytes = encoded(bundle)
        checks = {key: 0 for key in ("firstInstallExitCode", "overwriteExitCode", "uninstallExitCode")}
        for key in ("stage", "firstInstall", "overwrite"):
            checks[key] = {"manifestFilesVerified": 2, "manifestSha256": digest(bundle_bytes)}
        checks.update(overwriteExternalDataPreserved=True, uninstallExternalDataPreserved=True,
                      externalSyntheticDataSha256=digest(b"sentinel"))
        smoke = {"status": "passed", "version": "6.1.0", "sourceCommit": COMMIT, "installerSha256": digest(installer),
                 "scope": "install-overwrite-uninstall-payload-only", "applicationLaunched": False,
                 "realUserDataAccessed": False, "error": None, "checks": checks}
        readiness = {key: True for key in ("ok", "inheritedIsolationRejected", "productionGroupReadsAvailable", "mockGroupWritesRejected",
                     "healthScopeTruthful", "readyWithoutUiPump", "cancellationPropagated", "unauthorizedShutdownRejected",
                     "authenticatedGracefulShutdown", "cancelledStartAndRestartRetired")}
        readiness.update(productionOpened=False, exitCode=0)
        self.files = {INSTALLER: installer, "release-output-manifest.json": encoded(manifest),
                      "bundle-manifest.json": bundle_bytes, "installer-smoke-result.json": encoded(smoke),
                      "sidecar-readiness.txt": b"Build output may precede evidence.\n" + encoded(readiness) + b"\n"}
        self.refresh_archive()

    def refresh_archive(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            for name, content in self.files.items():
                archive.writestr(name, content)
        self.archive = stream.getvalue()
        self.artifact.update(size_in_bytes=len(self.archive), digest="sha256:" + digest(self.archive))

    def change_json(self, name, transform):
        document = json.loads(self.files[name])
        transform(document)
        self.files[name] = encoded(document)
        self.refresh_archive()

    def api(self, route, method="GET", body=None, missing_ok=False):
        if method != "GET":
            self.mutations.append((method, route, copy.deepcopy(body)))
        if route == "":
            result = self.repository
        elif route.startswith("contents/"):
            path = route[9:].split("?", 1)[0]
            text = json.dumps({"version": self.source_version}) if path.endswith("package.json") else self.notes
            result = {"path": path, "type": "file", "encoding": "base64", "content": base64.b64encode(text.encode()).decode()}
        elif route == "actions/workflows/windows-validation.yml":
            result = {"id": 20, "path": publisher.WORKFLOW}
        elif route == "actions/runs/100":
            result = self.run
        elif route.startswith("actions/runs/100/artifacts?"):
            result = {"artifacts": [self.artifact]}
        elif route == f"git/ref/tags/{TAG}":
            if self.tag is None:
                if missing_ok:
                    return None
                raise AssertionError("Missing tag")
            result = {"ref": f"refs/tags/{TAG}", "object": {"type": "commit", "sha": self.tag}}
        elif route == "git/refs" and method == "POST":
            assert self.tag is None, "Existing tags must never be replaced"
            self.tag = body["sha"]
            result = {"ref": body["ref"], "object": {"type": "commit", "sha": self.tag}}
        elif route.startswith("releases?"):
            result = [self.history] + ([self.release] if self.release else [])
        elif route == "releases" and method == "POST":
            assert self.release is None, "Existing releases must never be replaced"
            self.release = dict(body, id=300, html_url=f"https://github.com/{publisher.REPO}/releases/tag/{TAG}",
                                upload_url=f"https://uploads.github.com/repos/{publisher.REPO}/releases/300/assets{{?name,label}}")
            result = self.release
        elif route == "releases/300":
            if method == "PATCH":
                assert self.release["draft"], "Published releases must never be modified"
                self.release.update(body)
            result = self.release
        elif route.startswith("releases/300/assets?"):
            result = self.remote_assets
        else:
            raise AssertionError(f"Unexpected API request: {method} {route}")
        return copy.deepcopy(result)

    def download(self, artifact_id, destination):
        assert artifact_id == 200
        destination.write_bytes(self.archive)

    def signature(self, installer):
        assert installer.name == INSTALLER
        return self.signature_value

    def upload(self, release_id, path):
        assert release_id == 300 and self.release["draft"]
        assert path.name not in {asset["name"] for asset in self.remote_assets}, "Assets must never be overwritten"
        self.mutations.append(("UPLOAD", path.name))
        self.remote_assets.append({"name": path.name, "state": "uploaded", "size": path.stat().st_size,
                                   "digest": "sha256:" + publisher.sha256(path)})


class CandidatePublisherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="zhike-publisher-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.client = Fixture()
        self.sequence = 0

    def invoke(self, publish=False, resume=0, **overrides):
        self.sequence += 1
        options = dict(tag=TAG, run_id=100, commit=COMMIT, artifact_directory=self.root / "work" / f"candidate-{self.sequence}",
                       resume_draft_id=resume, publish=publish)
        options.update(overrides)
        return publisher.publish_candidate(argparse.Namespace(**options), self.client, self.root)

    def rejects_before_mutation(self, message):
        with self.assertRaisesRegex(RuntimeError, message):
            self.invoke(publish=True)
        self.assertEqual(self.client.mutations, [])

    def test_default_preflight_downloads_and_verifies_without_remote_changes(self):
        result = self.invoke()
        self.assertEqual(result["preflight"], "passed")
        self.assertTrue(result["createTag"])
        self.assertFalse(result["remoteWrites"])
        self.assertEqual(self.client.mutations, [])

    def test_new_candidate_is_created_as_draft_then_verified_and_published(self):
        history = copy.deepcopy(self.client.history)
        result = self.invoke(publish=True)
        self.assertEqual(result["status"], "published")
        self.assertEqual(self.client.mutations[0][1], "git/refs")
        self.assertTrue(self.client.mutations[1][2]["draft"])
        self.assertEqual([entry[0] for entry in self.client.mutations], ["POST", "POST", "UPLOAD", "UPLOAD", "PATCH"])
        self.assertFalse(self.client.release["draft"])
        self.assertEqual(self.client.release["make_latest"], "false")
        self.assertEqual(self.client.history, history)

    def test_rejects_failed_run_wrong_commit_repository_or_workflow(self):
        changes = [lambda c: c.run.update(conclusion="failure"), lambda c: c.run.update(head_sha="b" * 40),
                   lambda c: c.run.update(workflow_id=999), lambda c: c.run.update(path=".github/workflows/other.yml"),
                   lambda c: c.run["head_repository"].update(full_name="someone/fork")]
        for change in changes:
            with self.subTest(change=change):
                self.client = Fixture()
                change(self.client)
                self.rejects_before_mutation("expected repository/workflow")

    def test_rejects_wrong_artifact_source_or_expired_artifact(self):
        for field, value in (("id", 99), ("head_sha", "b" * 40), ("head_repository_id", 99)):
            with self.subTest(field=field):
                self.client = Fixture()
                self.client.artifact["workflow_run"][field] = value
                self.rejects_before_mutation("provenance")
        self.client = Fixture()
        self.client.artifact["expired"] = True
        self.rejects_before_mutation("provenance")

    def test_rejects_tampered_zip_even_when_manifest_is_unchanged(self):
        self.client.archive += b"tampered"
        self.rejects_before_mutation("ZIP digest or size mismatch")

    def test_rejects_wrong_installer_hash_size_or_manifest_source(self):
        for field, value in (("sha256", "0" * 64), ("bytes", 1), ("sourceCommit", "b" * 40)):
            with self.subTest(field=field):
                self.client = Fixture()
                self.client.change_json("release-output-manifest.json", lambda value_dict: value_dict.update({field: value}))
                self.rejects_before_mutation("manifest|SHA-256")

    def test_rejects_unexpected_zip_entry(self):
        self.client.files["../outside.txt"] = b"untrusted"
        self.client.refresh_archive()
        self.rejects_before_mutation("unexpected files")

    def test_rejects_signature_status_mismatch(self):
        self.client.signature_value = "HashMismatch"
        self.rejects_before_mutation("Authenticode")
        self.client.signature_value = "Valid"
        self.rejects_before_mutation("Authenticode")

    def test_accepts_valid_signed_candidate(self):
        self.client.signature_value = "Valid"
        self.client.change_json("release-output-manifest.json", lambda value: value.update(signingStatus="signed-and-verified"))
        self.assertEqual(self.invoke()["signature"], "Valid")
        self.assertEqual(self.client.mutations, [])

    def test_github_json_subprocess_decodes_utf8_on_windows(self):
        document = {"name": "知客候选", "body": "当前账号扫码登录"}
        payload = json.dumps(document, ensure_ascii=False).encode("utf-8")
        real_run = publisher.subprocess.run

        def fake_gh(command, **options):
            self.assertEqual(command[0], "gh")
            self.assertEqual(options.get("encoding"), "utf-8")
            return real_run([sys.executable, "-c", f"import sys; sys.stdout.buffer.write({payload!r})"], **options)

        with patch.object(publisher.subprocess, "run", side_effect=fake_gh):
            self.assertEqual(publisher.GitHub().api("releases/300"), document)

    def test_rejects_incomplete_smoke_or_sidecar_evidence(self):
        self.client.change_json("installer-smoke-result.json", lambda value: value["checks"].update(uninstallExternalDataPreserved=False))
        self.rejects_before_mutation("retention")
        self.client = Fixture()
        self.client.files["sidecar-readiness.txt"] = b'{"ok":true}\n'
        self.client.refresh_archive()
        self.rejects_before_mutation("readiness")

    def test_rejects_version_mismatch_or_stale_release_notes(self):
        self.client.source_version = "6.2.0"
        self.rejects_before_mutation("source package version")
        self.client = Fixture()
        self.client.notes = "# v6.1.0-rc.3 historical release"
        self.rejects_before_mutation("candidate tag")

    def test_rejects_existing_tag_at_other_commit(self):
        self.client.tag = "b" * 40
        self.rejects_before_mutation("different source")

    def test_published_candidate_is_idempotent_and_never_replaced(self):
        self.invoke(publish=True)
        release = copy.deepcopy(self.client.release)
        self.client.mutations.clear()
        result = self.invoke(publish=True)
        self.assertEqual(result["status"], "already-published")
        self.assertFalse(result["remoteWrites"])
        self.assertEqual(self.client.mutations, [])
        self.assertEqual(self.client.release, release)
        self.client.remote_assets[0]["digest"] = "sha256:" + "0" * 64
        self.rejects_before_mutation("Remote asset mismatch")

    def test_draft_resume_requires_exact_id_and_preserves_verified_asset(self):
        self.invoke(publish=True)
        self.client.release["draft"] = True
        self.client.remote_assets.pop()
        self.client.mutations.clear()
        self.rejects_before_mutation("explicit resume ID")
        result = self.invoke(publish=True, resume=300)
        self.assertEqual(result["status"], "published")
        self.assertEqual([item[0] for item in self.client.mutations], ["UPLOAD", "PATCH"])
        self.assertEqual(len(self.client.remote_assets), 2)

    def test_unknown_remote_asset_is_rejected_without_deletion(self):
        self.invoke(publish=True)
        self.client.release["draft"] = True
        self.client.remote_assets.append({"name": "unrelated.txt"})
        self.client.mutations.clear()
        with self.assertRaisesRegex(RuntimeError, "Unexpected or duplicate"):
            self.invoke(publish=True, resume=300)
        self.assertEqual(self.client.mutations, [])

    def test_rejects_outside_artifact_path_and_invalid_candidate_tag(self):
        with self.assertRaisesRegex(RuntimeError, "fresh child"):
            self.invoke(artifact_directory=self.root / "outside")
        with self.assertRaisesRegex(RuntimeError, "Explicit candidate"):
            self.invoke(tag="v6.1.0")
        self.assertEqual(self.client.mutations, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
