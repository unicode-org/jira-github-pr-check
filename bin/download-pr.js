#!/usr/bin/env node
// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

// Use this script to download a PR JSON for testing with check-single-pr.js.
// Example: node bin/download-pr.js > inputs/lfstest0_4.json

"use strict";

require("dotenv").config();

const github = require("../src/github-status");

const argv = require("yargs")
	.option("owner", {
		default: "unicode-org"
	})
	.option("repo", {
		default: "lfstest0"
	})
	.option("number", {
		default: "4"
	})
	.argv;

async function main() {
	const pullRequest = await github.getPullRequest({
		owner: argv.owner,
		repo: argv.repo,
		pull_number: argv.number
	});
	return pullRequest;
}

main().then((pullRequest) => {
	console.log(JSON.stringify(pullRequest));
});
