"""Publish only the already verified rc.3 draft; never replace release assets.

Default mode is read-only. The candidate identities and digests deliberately
bind this recovery to one successful build, tag, draft and pair of assets.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

REPO = "vincent12233/zhike-4.2-ws-workbench"
COMMIT = "bddb8ae33604110cdd191d7b7589fc8fe9d692bf"
TAG = "v6.1.0-rc.3"
RELEASE_ID = 451230083
RUN_ID = 44510928815
BODY_SHA = "9eca798fe45a6de87e7ac04c935091b707bec2a57783edf0f9b872229f4a888d"
ASSETS = {
    "zhike-6.1.0-win-x64-setup.exe": (114177547, "f8d7ca52106ba9a7ce824df4ae79a217c36d5860f499b9b6775138919498988b"),
    "release-output-manifest.json": (442, "b3932186cde2c8b42a1e924c382b40c51a5bcad80a431d6a4a3082a6f1343b83"),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True)


def api(path):
    return json.loads(gh("api", f"repos/{REPO}/{path}"))


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def check_release():
    release = api(f"releases/{RELEASE_ID}")
    require(release["id"] == RELEASE_ID and release["tag_name"] == TAG
            and release["target_commitish"] == COMMIT and release["prerelease"], "Release identity changed")
    require(hashlib.sha256(release["body"].encode()).hexdigest() == BODY_SHA, "Release notes changed")
    present = {}
    for asset in release["assets"]:
        name = asset["name"]
        require(name in ASSETS and name not in present, "Unexpected or duplicate release asset")
        size, sha = ASSETS[name]
        require(asset["state"] == "uploaded" and asset["size"] == size
                and asset.get("digest") == "sha256:" + sha, f"Remote asset mismatch: {name}")
        present[name] = asset
    return release, present


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact_directory", type=Path)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    root = args.artifact_directory.resolve(strict=True)
    for name, (size, sha) in ASSETS.items():
        asset = root / name
        require(asset.is_file() and not asset.is_symlink()
                and asset.stat().st_size == size and digest(asset) == sha, f"Local asset mismatch: {name}")
    manifest = json.loads((root / "release-output-manifest.json").read_text(encoding="utf-8-sig"))
    require(manifest["sourceCommit"] == COMMIT and manifest["releaseGate"] == "passed"
            and manifest["version"] == "6.1.0" and manifest["signingStatus"] == "unsigned", "Invalid build manifest")
    smoke = json.loads((root / "installer-smoke-result.json").read_text(encoding="utf-8-sig"))
    require(smoke["status"] == "passed" and smoke["sourceCommit"] == COMMIT
            and smoke["installerSha256"].lower() == ASSETS[manifest["releaseAsset"]][1], "Installation smoke did not pass")
    run = api(f"actions/runs/{RUN_ID}")
    require(run["head_sha"] == COMMIT and run["status"] == "completed"
            and run["conclusion"] == "success", "Candidate build did not pass")
    require(api(f"git/ref/tags/{TAG}")["object"]["sha"] == COMMIT, "Candidate tag moved")
    release, present = check_release()
    if not args.publish:
        print(json.dumps({"preflight": "passed", "remoteWrites": False, "draft": release["draft"], "existingAssets": list(present)}))
        return
    if not release["draft"]:
        require(set(present) == set(ASSETS), "Published release has incomplete assets")
        print(release["html_url"])
        return
    for name in ASSETS:
        if name not in present:
            subprocess.run(["gh", "release", "upload", TAG, str(root / name), "--repo", REPO], check=True)
            _, present = check_release()
    release, present = check_release()
    require(release["draft"] and set(present) == set(ASSETS), "Draft is not ready to publish")
    require(api(f"git/ref/tags/{TAG}")["object"]["sha"] == COMMIT, "Candidate tag moved before publishing")
    subprocess.run(["gh", "release", "edit", TAG, "--repo", REPO,
                    "--draft=false", "--prerelease", "--latest=false"], check=True)
    release, present = check_release()
    require(not release["draft"] and set(present) == set(ASSETS), "Release was not published completely")
    print(release["html_url"])


if __name__ == "__main__":
    main()
