"""Verify one successful Windows build; optionally create/publish its prerelease.

Default mode makes no remote changes. Published assets and existing tags are
never replaced. Resuming a draft requires its explicit numeric ID.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
from urllib.parse import quote
import zipfile

REPO = "vincent12233/zhike-4.2-ws-workbench"
WORKFLOW = ".github/workflows/windows-validation.yml"
ROOT = Path(__file__).resolve().parents[1]
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
MAX_ARCHIVE = 500 * 1024 * 1024
EVIDENCE = {"release-output-manifest.json", "bundle-manifest.json",
            "installer-smoke-result.json", "sidecar-readiness.txt"}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def positive_integer(value):
    return type(value) is int and value > 0


class GitHub:
    def api(self, route, method="GET", body=None, missing_ok=False):
        command = ["gh", "api", f"repos/{REPO}/{route}", "--method", method,
                   "--header", "Accept: application/vnd.github+json"]
        if body is not None:
            command += ["--input", "-"]
        result = subprocess.run(command, input=json.dumps(body) if body is not None else None,
                                capture_output=True, text=True, encoding="utf-8", timeout=180)
        if result.returncode:
            if missing_ok and "(HTTP 404)" in result.stderr:
                return None
            # Do not echo command output, headers or credential-helper details.
            raise RuntimeError(f"GitHub {method} {route} failed; no assets were replaced.")
        return json.loads(result.stdout)

    def pages(self, route):
        result = []
        for page in range(1, 101):
            items = self.api(f"{route}?per_page=100&page={page}")
            require(isinstance(items, list), "Invalid paginated GitHub response")
            result.extend(items)
            if len(items) < 100:
                return result
        raise RuntimeError("GitHub pagination safety limit reached")

    def download(self, artifact_id, destination):
        with destination.open("wb") as stream:
            result = subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{artifact_id}/zip"],
                                    stdout=stream, stderr=subprocess.PIPE, timeout=600)
        require(result.returncode == 0, "Verified artifact download failed")

    def signature(self, installer):
        require(os.name == "nt", "Actual Authenticode verification requires Windows")
        env = dict(os.environ, ZHIKE_CANDIDATE_INSTALLER=str(installer))
        result = subprocess.run([
            "pwsh", "-NoProfile", "-NonInteractive", "-Command",
            "$ErrorActionPreference='Stop'; (Get-AuthenticodeSignature -LiteralPath $env:ZHIKE_CANDIDATE_INSTALLER).Status.ToString()"
        ], capture_output=True, text=True, encoding="utf-8", env=env, timeout=60)
        require(result.returncode == 0, "Authenticode inspection failed")
        return result.stdout.strip()

    def upload(self, release_id, path):
        endpoint = f"https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets?name={quote(path.name)}"
        content_type = "application/json" if path.suffix == ".json" else "application/octet-stream"
        result = subprocess.run(["gh", "api", endpoint, "--method", "POST", "--input", str(path),
                                 "--header", f"Content-Type: {content_type}"],
                                capture_output=True, timeout=600)
        require(result.returncode == 0, "Asset upload failed; inspect and explicitly resume the existing draft")


def source_file(client, commit, path):
    document = client.api(f"contents/{path}?ref={commit}")
    require(document.get("type") == "file" and document.get("encoding") == "base64"
            and document.get("path") == path, "Unexpected source document")
    content = base64.b64decode(document["content"], validate=False).decode("utf-8-sig")
    require(len(content) <= 60000, "Source document exceeds release limit")
    return content


def verified_build(client, args, version):
    repository = client.api("")
    require(repository.get("full_name") == REPO and positive_integer(repository.get("id")) and repository.get("private") is True
            and repository.get("permissions", {}).get("push") is True, "Unexpected repository or missing push access")
    workflow = client.api("actions/workflows/windows-validation.yml")
    require(workflow.get("path") == WORKFLOW and positive_integer(workflow.get("id")), "Unexpected validation workflow")
    run = client.api(f"actions/runs/{args.run_id}")
    require(run.get("id") == args.run_id and run.get("workflow_id") == workflow["id"]
            and run.get("path") == WORKFLOW and run.get("head_sha") == args.commit
            and run.get("repository", {}).get("full_name") == REPO
            and run.get("head_repository", {}).get("full_name") == REPO
            and run.get("status") == "completed" and run.get("conclusion") == "success",
            "Candidate run is not a successful exact-source build from the expected repository/workflow")
    expected_name = f"zhike-{version}-win-x64-{args.commit}"
    artifacts = []
    for page in range(1, 101):
        listing = client.api(f"actions/runs/{args.run_id}/artifacts?per_page=100&page={page}")
        entries = listing.get("artifacts")
        require(isinstance(entries, list), "Invalid artifact listing")
        artifacts.extend(item for item in entries if item.get("name") == expected_name)
        if len(entries) < 100:
            break
    else:
        raise RuntimeError("Artifact listing safety limit reached")
    require(len(artifacts) == 1, "Expected exactly one source-bound candidate artifact")
    artifact = artifacts[0]
    origin = artifact.get("workflow_run", {})
    require(positive_integer(artifact.get("id")) and artifact.get("expired") is False
            and positive_integer(artifact.get("size_in_bytes")) and artifact["size_in_bytes"] <= MAX_ARCHIVE
            and re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest", ""))
            and origin.get("id") == args.run_id and origin.get("head_sha") == args.commit
            and origin.get("repository_id") == repository.get("id")
            and origin.get("head_repository_id") == repository.get("id"), "Artifact provenance or digest is invalid")
    return artifact


def download_artifact(client, artifact, directory, installer_name, repository_root):
    raw = directory if directory.is_absolute() else repository_root / directory
    require(".." not in raw.parts, "Artifact directory cannot contain parent traversal")
    for path in (raw, *raw.parents):
        require(not path.is_symlink(), "Artifact directory cannot traverse a link")
    root = raw.resolve()
    require(root.is_relative_to(repository_root / "work") and root != repository_root / "work"
            and not root.exists(), "Artifact directory must be a fresh child of repository work/")
    root.parent.mkdir(parents=True, exist_ok=True)
    expected = EVIDENCE | {installer_name}
    with tempfile.TemporaryDirectory(prefix="candidate-download-", dir=root.parent) as temporary:
        archive = Path(temporary) / "artifact.zip"
        client.download(artifact["id"], archive)
        require(archive.stat().st_size == artifact["size_in_bytes"] and archive.stat().st_size <= MAX_ARCHIVE
                and "sha256:" + sha256(archive) == artifact["digest"], "Downloaded artifact ZIP digest or size mismatch")
        with zipfile.ZipFile(archive) as package:
            entries = package.infolist()
            require(len(entries) == len(expected) and {entry.filename for entry in entries} == expected,
                    "Candidate artifact contains missing, duplicate or unexpected files")
            for entry in entries:
                require(not entry.is_dir() and not stat.S_ISLNK(entry.external_attr >> 16)
                        and 0 < entry.file_size <= (MAX_ARCHIVE if entry.filename == installer_name else 5 * 1024 * 1024),
                        "Unsafe or oversized artifact entry")
            root.mkdir()
            for entry in entries:
                with package.open(entry) as source, (root / entry.filename).open("xb") as target:
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
    return root


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def verified_files(client, root, version, commit):
    manifest = load_json(root / "release-output-manifest.json")
    installer_name = f"zhike-{version}-win-x64-setup.exe"
    require(manifest.get("version") == version and manifest.get("sourceCommit") == commit
            and manifest.get("releaseGate") == "passed" and manifest.get("releaseAsset") == installer_name
            and manifest.get("installer") == f"知客-{version}-WinUI桌面版.exe"
            and positive_integer(manifest.get("bytes")) and SHA256.fullmatch(manifest.get("sha256", "")),
            "Installer manifest does not identify the exact gated candidate")
    installer = root / installer_name
    installer_hash = sha256(installer)
    require(installer.stat().st_size == manifest["bytes"] and installer_hash == manifest["sha256"].lower(),
            "Installer size or SHA-256 mismatch")
    signature = client.signature(installer)
    require(signature in ("Valid", "NotSigned")
            and {"Valid": "signed-and-verified", "NotSigned": "unsigned"}[signature] == manifest.get("signingStatus"),
            "Actual Authenticode status does not match the manifest")
    bundle_path = root / "bundle-manifest.json"
    bundle = load_json(bundle_path)
    require(bundle.get("version") == version and bundle.get("sourceCommit") == commit
            and bundle.get("releaseGate") == "passed" and bundle.get("sourceWorktreeDirty") is False
            and bundle.get("runtime") == "win-x64" and bundle.get("selfContained") is True,
            "Bundle is not the clean self-contained candidate")
    files = bundle.get("files", [])
    require(isinstance(files, list) and files, "Bundle file manifest is empty")
    names = set()
    for item in files:
        name = item.get("path", "")
        require(isinstance(name, str) and name and "\\" not in name and not PurePosixPath(name).is_absolute()
                and all(part not in ("", ".", "..") for part in name.split("/"))
                and not re.search(r'[<>:"|?*\x00-\x1f]', name) and name.casefold() not in names
                and type(item.get("bytes")) is int and item["bytes"] >= 0 and SHA256.fullmatch(item.get("sha256", "")),
                "Invalid or duplicate bundle file entry")
        names.add(name.casefold())
    require({"zhike.desktop.exe", "zhike.ico"}.issubset(names), "Bundle is missing its application or icon")
    smoke = load_json(root / "installer-smoke-result.json")
    require(smoke.get("status") == "passed" and smoke.get("version") == version and smoke.get("sourceCommit") == commit
            and smoke.get("installerSha256", "").lower() == installer_hash
            and smoke.get("scope") == "install-overwrite-uninstall-payload-only"
            and smoke.get("applicationLaunched") is False and smoke.get("realUserDataAccessed") is False
            and smoke.get("error") is None, "Installation smoke did not pass for this candidate")
    checks = smoke.get("checks", {})
    for phase in ("firstInstall", "overwrite", "uninstall"):
        require(type(checks.get(phase + "ExitCode")) is int and checks[phase + "ExitCode"] == 0,
                "Installer smoke phase failed")
    for phase in ("stage", "firstInstall", "overwrite"):
        check = checks.get(phase, {})
        require(check.get("manifestFilesVerified") == len(files)
                and check.get("manifestSha256", "").lower() == sha256(bundle_path), "Smoke bundle verification mismatch")
    require(checks.get("overwriteExternalDataPreserved") is True and checks.get("uninstallExternalDataPreserved") is True
            and SHA256.fullmatch(checks.get("externalSyntheticDataSha256", "")), "Synthetic data retention was not verified")
    readiness = None
    for line in reversed((root / "sidecar-readiness.txt").read_text(encoding="utf-8-sig").splitlines()):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            readiness = value
            break
    required = ("ok", "inheritedIsolationRejected", "productionGroupReadsAvailable", "mockGroupWritesRejected",
                "healthScopeTruthful", "readyWithoutUiPump", "cancellationPropagated", "unauthorizedShutdownRejected",
                "authenticatedGracefulShutdown", "cancelledStartAndRestartRetired")
    require(readiness is not None and all(readiness.get(key) is True for key in required)
            and readiness.get("productionOpened") is False and readiness.get("exitCode") == 0,
            "Packaged sidecar readiness evidence did not pass")
    assets = {}
    for name in (installer_name, "release-output-manifest.json"):
        path = root / name
        assets[name] = {"path": path, "size": path.stat().st_size, "digest": "sha256:" + sha256(path)}
    return assets, signature


def tag_commit(client, tag):
    reference = client.api(f"git/ref/tags/{tag}", missing_ok=True)
    if reference is None:
        return None
    require(reference.get("ref") == f"refs/tags/{tag}", "Unexpected candidate tag reference")
    target = reference.get("object", {})
    for _ in range(8):
        if target.get("type") == "commit":
            return target.get("sha")
        require(target.get("type") == "tag" and re.fullmatch(r"[0-9a-f]{40}", target.get("sha", "")),
                "Unsupported candidate tag target")
        target = client.api(f"git/tags/{target['sha']}").get("object", {})
    raise RuntimeError("Candidate tag nesting limit reached")


def release_assets(client, release, args, body, assets):
    release_id = release.get("id")
    require(positive_integer(release_id) and release.get("tag_name") == args.tag
            and release.get("target_commitish") == args.commit and release.get("name") == f"知客 {args.tag}"
            and release.get("body") == body and release.get("prerelease") is True
            and type(release.get("draft")) is bool
            and release.get("upload_url") == f"https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets{{?name,label}}",
            "Existing release identity or notes differ; refusing to modify it")
    present = set()
    for asset in client.pages(f"releases/{release_id}/assets"):
        name = asset.get("name")
        require(name in assets and name not in present, "Unexpected or duplicate release asset; nothing will be overwritten")
        expected = assets[name]
        require(asset.get("state") == "uploaded" and asset.get("size") == expected["size"]
                and asset.get("digest", "").lower() == expected["digest"], "Remote asset mismatch; nothing will be overwritten")
        present.add(name)
    return present


def publish_candidate(args, client=None, repository_root=ROOT):
    client = client or GitHub()
    match = re.fullmatch(r"v(\d+\.\d+\.\d+)-rc\.([1-9]\d*)", args.tag)
    require(match is not None and re.fullmatch(r"[0-9a-f]{40}", args.commit)
            and positive_integer(args.run_id) and type(args.resume_draft_id) is int and args.resume_draft_id >= 0,
            "Explicit candidate tag, positive run ID and full lowercase source commit are required")
    version = match[1]
    package = json.loads(source_file(client, args.commit, "resources/app/package.json"))
    require(package.get("version") == version, "Candidate tag does not match the source package version")
    notes = source_file(client, args.commit, f"docs/release/release-notes-{version}.md")
    require(notes.strip() and args.tag in notes, "Source release notes must identify this candidate tag")
    artifact = verified_build(client, args, version)
    root = download_artifact(client, artifact, Path(args.artifact_directory), f"zhike-{version}-win-x64-setup.exe", repository_root)
    assets, signature = verified_files(client, root, version, args.commit)
    body = (f"{notes.rstrip()}\n\nSource commit: {args.commit}\n"
            f"Build: https://github.com/{REPO}/actions/runs/{args.run_id}\n"
            f"Installer SHA-256: {assets[f'zhike-{version}-win-x64-setup.exe']['digest'][7:]}\nAuthenticode: {signature}")
    target = tag_commit(client, args.tag)
    require(target in (None, args.commit), "Candidate tag points to a different source commit")
    matches = [release for release in client.pages("releases") if release.get("tag_name") == args.tag]
    require(len(matches) <= 1, "Duplicate candidate releases exist")
    release = matches[0] if matches else None
    present = set()
    if release:
        require(target == args.commit, "Existing release has no exact candidate tag")
        present = release_assets(client, release, args, body, assets)
        if not release["draft"]:
            require(args.resume_draft_id == 0 and present == set(assets), "Published release is not an exact complete match")
            return {"status": "already-published", "remoteWrites": False, "url": release["html_url"]}
        require(args.resume_draft_id == release["id"], "Existing draft requires its explicit resume ID")
    else:
        require(args.resume_draft_id == 0, "No matching draft exists for the requested resume ID")
    if not args.publish:
        return {"preflight": "passed", "remoteWrites": False, "tag": args.tag, "sourceCommit": args.commit,
                "runId": args.run_id, "artifactId": artifact["id"], "signature": signature,
                "createTag": target is None, "resumeDraftId": args.resume_draft_id,
                "uploadAssets": sorted(set(assets) - present)}
    require(verified_build(client, args, version) == artifact, "Candidate build artifact changed before publishing")
    require(tag_commit(client, args.tag) == target, "Candidate tag changed before publishing")
    if target is None:
        client.api("git/refs", "POST", {"ref": f"refs/tags/{args.tag}", "sha": args.commit})
    require(tag_commit(client, args.tag) == args.commit, "Candidate tag was not created at the exact source commit")
    if release is None:
        require(not any(item.get("tag_name") == args.tag for item in client.pages("releases")), "Candidate release appeared during preflight")
        release = client.api("releases", "POST", {"tag_name": args.tag, "target_commitish": args.commit,
                            "name": f"知客 {args.tag}", "body": body, "draft": True, "prerelease": True, "make_latest": "false"})
    release_id = release["id"]
    for name in assets:
        release = client.api(f"releases/{release_id}")
        require(release.get("draft") is True, "Release stopped being a draft; refusing further changes")
        present = release_assets(client, release, args, body, assets)
        if name not in present:
            # Recheck local files immediately before upload; never use --clobber.
            path = assets[name]["path"]
            require(path.stat().st_size == assets[name]["size"] and "sha256:" + sha256(path) == assets[name]["digest"],
                    "Local release asset changed after verification")
            client.upload(release_id, path)
    require(verified_build(client, args, version) == artifact and tag_commit(client, args.tag) == args.commit,
            "Build or candidate tag changed before final publication")
    release = client.api(f"releases/{release_id}")
    require(release.get("draft") is True and release_assets(client, release, args, body, assets) == set(assets),
            "Draft does not contain the complete verified asset set")
    client.api(f"releases/{release_id}", "PATCH", {"draft": False, "prerelease": True, "make_latest": "false"})
    release = client.api(f"releases/{release_id}")
    require(release.get("draft") is False and release_assets(client, release, args, body, assets) == set(assets),
            "Final published candidate verification failed")
    return {"status": "published", "remoteWrites": True, "releaseId": release_id, "tag": args.tag,
            "sourceCommit": args.commit, "artifactId": artifact["id"], "url": release["html_url"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--artifact-directory", type=Path, required=True)
    parser.add_argument("--resume-draft-id", type=int, default=0)
    parser.add_argument("--publish", action="store_true")
    print(json.dumps(publish_candidate(parser.parse_args()), ensure_ascii=False))


if __name__ == "__main__":
    main()
