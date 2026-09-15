#!/bin/sh
set -eu
# Run only after the mandatory browser gate. A separate checkout carries scoped credentials.
test -s dist/release.json
test -s artifacts/checks.json
python3 -c 'import json; a=json.load(open("artifacts/checks.json")); assert not a["errors"] and a["passed"] >= 40'
cd release-store
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
if git ls-remote --exit-code --heads origin samai-landing-releases >/dev/null 2>&1; then
  git fetch origin samai-landing-releases
  git checkout --detach FETCH_HEAD
else
  git checkout --orphan samai-release-initial
fi
git rm -rf --ignore-unmatch . >/dev/null
cp -R ../dist/. .
git add .
git commit -m "Tested SAMAI release ${GITHUB_SHA} run ${GITHUB_RUN_ID}"
git push origin HEAD:refs/heads/samai-landing-releases
