// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const bodyParser = require("body-parser");
const crypto = require("crypto");
const express = require("express");
const morgan = require("morgan");

const github = require("./src/github-status");
const jira = require("./src/jira-status");

const JIRA_COMMIT_PATTERN = /^([A-Z]+-\d+)\u0020\w/;
const PR_BODY_VAR_PATTERN = /^([A-Z_]+)=(.*?)(\s*#.*)?$/gm;

function parseMessage(message) {
	const match = JIRA_COMMIT_PATTERN.exec(message);
	if (!match) {
		return null;
	}
	return match[1];
}

function parsePullRequestFlags(body) {
	PR_BODY_VAR_PATTERN.lastIndex = 0; // reset /g regex
	let prFlags = {};
	let match;
	// eslint-disable-next-line no-cond-assign
	while (match = PR_BODY_VAR_PATTERN.exec(body)) {
		let value = match[2];
		if (value === "true") {
			value = true;
		} else if (value === "false") {
			value = false;
		} else if (!isNaN(parseFloat(value))) {
			value = parseFloat(value);
		}
		prFlags[match[1]] = value;
	}
	return prFlags;
}

async function getJiraInfo(pullRequest) {
	const prFlags = parsePullRequestFlags(pullRequest.body);
	const issueKey = parseMessage(pullRequest.title);
	if (!issueKey) {
		return {
			issueKey: null,
			prFlags,
			pass: false,
			description: "Pull request title must start with a Jira ticket ID"
		};
	}

	// Load additional data from Jira and GitHub
	const [jiraIssue, commits] = await Promise.all([
		jira.getStatus(issueKey),
		github.getCommits({
			owner: pullRequest.base.repo.owner.login,
			repo: pullRequest.base.repo.name,
			number: pullRequest.number
		})
	]);
	const jiraStatus = jiraIssue && jiraIssue.fields.status.name;
	const jiraSummary = jiraIssue && jiraIssue.fields.summary;
	const numCommits = commits.length;
	const isMaintMerge = (pullRequest.base.ref === "master"
		&& pullRequest.head.ref.match(/^maint\//)
		&& pullRequest.base.repo.full_name == pullRequest.head.repo.full_name);

	// Check Jira ticket for validity
	if (jiraStatus !== "Accepted" &&
			jiraStatus !== "Reviewing" &&
			jiraStatus !== "Review Feedback") {
		return {
			issueKey,
			jiraStatus,
			numCommits,
			isMaintMerge,
			prFlags,
			pass: false,
			description: jiraStatus === null ?
				"Jira ticket " + issueKey + " not found" :
				"Jira ticket " + issueKey + " is not accepted; it has status " + jiraStatus
		};
	}

	// Check for consistency with the commit messages
	for (const commitInfo of commits) {
		const commitIssueKey = parseMessage(commitInfo.commit.message);
		if (commitIssueKey === null) {
			return {
				issueKey,
				jiraStatus,
				numCommits,
				isMaintMerge,
				prFlags,
				pass: false,
				description: "Commit message for " + commitInfo.sha.substr(0, 7) + " fails validation",
				badCommit: commitInfo
			};
		} else if (commitIssueKey !== issueKey && !prFlags["DISABLE_JIRA_ISSUE_MATCH"] && !isMaintMerge) {
			return {
				issueKey,
				jiraStatus,
				numCommits,
				isMaintMerge,
				prFlags,
				pass: false,
				description: "Commit " + commitInfo.sha.substr(0, 7) + " is for " + commitIssueKey + ", but the PR is for " + issueKey + "; to disable, set DISABLE_JIRA_ISSUE_MATCH=true in the PR description",
				badCommit: commitInfo
			};
		}
	}

	// Since we can't easilly check more than 100 commits, reject PRs with more than 100 commits
	if (commits.length === 100) {
		return {
			issueKey,
			jiraStatus,
			numCommits,
			isMaintMerge,
			prFlags,
			pass: false,
			description: "PR has more than 100 commits; please rebase and squash"
		};
	}

	// All checks passed
	return {
		issueKey,
		jiraStatus,
		numCommits,
		isMaintMerge,
		prFlags,
		pass: true,
		description: issueKey + " \u201C" + jiraSummary + "\u201D (status is " + jiraStatus + ")"
	};
}

async function checkForcePush({ before, after }, pullRequest) {
	const owner = pullRequest.base.repo.owner.login;
	const repo = pullRequest.base.repo.name;
	// Check to see if this was a force push
	const compRes = await github.getCommitDiff({ owner, repo, base: before, head: after });
	if (compRes.status !== "diverged") {
		// Not a force push
		console.log("Push to branch status:", compRes.status);
		return;
	}
	const base = pullRequest.base.sha;
	const number = pullRequest.number;
	const [ beforeRes, afterRes ] = await Promise.all([
		github.getCommitDiff({ owner, repo, base, head: before }),
		github.getCommitDiff({ owner, repo, base, head: after })
	]);
	const compareFilename = (a, b) => {
		if (!a.filename) return 1;
		if (!b.filename) return -1;
		return a.filename.localeCompare(b.filename);
	};
	const beforeFiles = beforeRes.files.slice().sort(compareFilename);
	const afterFiles = afterRes.files.slice().sort(compareFilename);
	const errors = [];
	for (let i=0, j=0; i < beforeFiles.length || j < afterFiles.length; i++, j++) {
		let file1 = beforeFiles[i] || {};
		let file2 = afterFiles[j] || {};
		if (file1.filename === file2.filename && file1.sha === file2.sha) {
			continue;
		}
		if (file1.filename === file2.filename) {
			errors.push(file1.filename + " is different");
			continue;
		}
		if (compareFilename(file1, file2) < 0) {
			// file1 is earlier
			errors.push(file1.filename + " is no longer changed in the branch");
			j--; // re-evaluate file2
		} else {
			// file2 is earlier
			errors.push(file2.filename + " is now changed in the branch");
			i--; // re-evaluate file1
		}
	}
	let body;
	if (errors.length) {
		body = "Notice: the branch changed across the force-push!\n\n";
		errors.forEach((error) => {
			body += "- " + error + "\n";
		});
		const humanDiffUrl = `https://github.com/${owner}/${repo}/compare/${owner}:${before.substr(0, 7)}..${owner}:${after.substr(0, 7)}`;
		body += "\n[View Diff Across Force-Push](" + humanDiffUrl + ")";
		console.log(`Force-Push has diffs: ${owner}/${repo} ${before} ${after}`);
	} else {
		body = "Hooray! The files in the branch are the same across the force-push. 😃";
		console.log(`Force-Push has no file diffs: ${owner}/${repo} ${before} ${after}`);
	}
	body += "\n\n~ Your Friendly Jira-GitHub PR Checker Bot";
	return github.postComment({ owner, repo, number, body });
}

async function touch(pullRequest, jiraInfo) {
	const owner = pullRequest.base.repo.owner.login;
	const repo = pullRequest.base.repo.name;
	const number = pullRequest.number;
	const state = pullRequest.state;
	if (state !== "open") {
		console.log("Not touching: PR is " + state + ": " + number);
		return;
	}
	const url = process.env.URL_PREFIX + "/info/" + owner + "/" + repo + "/" + number;
	const multiCommitPass = jiraInfo.numCommits === 1
		|| (jiraInfo.numCommits > 1 && (jiraInfo.isMaintMerge || jiraInfo.prFlags["ALLOW_MANY_COMMITS"]));
	const multiCommitMessage = (jiraInfo.numCommits === 0) ? "No commits found on PR" : (jiraInfo.numCommits === 1) ? "This PR includes exactly 1 commit!" : "This PR has " + jiraInfo.numCommits + " commits" + (multiCommitPass ? "" : "; consider squashing.");
	const promises = [
		github.createStatus("jira-ticket", pullRequest, jiraInfo.pass, url, jiraInfo.description),
		github.createStatus("single-commit", pullRequest, multiCommitPass, undefined, multiCommitMessage)
	];
	if (jiraInfo.isMaintMerge) {
		promises.push(github.createStatus("maint-merge", pullRequest, false, undefined, "Reminder: use a MERGE COMMIT and new ticket in the message."));
	}
	return Promise.all(promises);
}

async function squash(params, pullRequest) {
	const owner = pullRequest.head.repo.owner.login;
	const repo = pullRequest.head.repo.name;
	const ref = "heads/" + pullRequest.head.ref;
	const parentSha = pullRequest.base.sha;
	const headSha = pullRequest.head.sha;
	const message = params.title + "\n\n" + params.description;
	const commitData = await github.writeSquashCommit({
		owner,
		repo,
		parentSha,
		headSha,
		message
	});
	await github.writeBranch({
		owner,
		repo,
		ref,
		sha: commitData.sha,
		force: true
	});
}

const app = express()
	.use(bodyParser.json({
		verify: (req, res, body /*, encoding*/) => {
			// Compute and save the hash of the raw body
			const key = process.env.GITHUB_WEBHOOK_SECRET;
			if (key) {
				const hash = crypto.createHmac("sha1", key);
				hash.update(body);
				req.bodyDigest = hash.digest("hex");
			}
		}
	}))
	.use(bodyParser.urlencoded({ extended: false }))
	.use(morgan("tiny"))
	.get("/info/:owner/:repo/:number", async (req, res) => {
		try {
			const pullRequest = await github.getPullRequest(req.params);
			const jiraInfo = await getJiraInfo(pullRequest);
			return res.render("info.ejs", {
				params: req.params,
				pullRequest,
				jiraInfo,
				jiraUrl: jiraInfo.issueKey ? jira.getUrl(jiraInfo.issueKey) : undefined,
				badCommit: jiraInfo.badCommit,
				checkerGithubUrl: require("./package.json").repository.url,
				instructionsUrl: process.env.INSTRUCTIONS_URL
			});
		} catch (err) {
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	})
	.post("/touch/:owner/:repo/:number", async (req, res) => {
		try {
			const pullRequest = await github.getPullRequest(req.params);
			const jiraInfo = await getJiraInfo(pullRequest);
			await touch(pullRequest, jiraInfo);
			return res.sendStatus(204);
		} catch (err) {
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	})
	.get("/squash/:owner/:repo/:number", async (req, res) => {
		try {
			const pullRequest = await github.getPullRequest(req.params);
			const jiraInfo = await getJiraInfo(pullRequest);
			return res.render("squash.ejs", {
				params: req.params,
				pullRequest,
				jiraInfo,
				checkerGithubUrl: require("./package.json").repository.url,
			});
		} catch (err) {
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	})
	.post("/do-squash", async (req, res) => {
		try {
			if (!req.body.confirm) {
				return res.status(422).send("Please check the confirmation box!");
			}
			const pullRequest = await github.getPullRequest(req.body);
			await squash(req.body, pullRequest);
			return res.redirect(process.env.URL_PREFIX + "/info/" + req.body.owner + "/" + req.body.repo + "/" + req.body.number);
		} catch (err) {
			if (err.code) {
				console.error(err);
				return res.sendStatus(err.code);
			} else {
				console.error(err);
				return res.sendStatus(500);
			}
		}
	})
	.post("/hook", async (req, res) => {
		if (req.bodyDigest) {
			const expectedSignature = "sha1=" + req.bodyDigest;
			const actualSignature = req.get("X-Hub-Signature");
			if (expectedSignature !== actualSignature) {
				console.log("Notice: Ignoring webhook request with bad signature: expected " + expectedSignature + "; got " + actualSignature);
				return res.sendStatus(403);
			}
		}
		try {
			const pullRequest = req.body.pull_request;
			// Check for push event
			if (req.body.action === "synchronize") {
				await checkForcePush(req.body, pullRequest);
			}
			const jiraInfo = await getJiraInfo(pullRequest);
			await touch(pullRequest, jiraInfo);
			return res.sendStatus(204);
		} catch (err) {
			console.error("Error when processing request:", err);
			if (err.status) {
				return res.sendStatus(err.status);
			} else {
				return res.sendStatus(500);
			}
		}
	});

module.exports = {
	app: (req, res) => {
		return app(req, res);
	},
	getJiraInfo,
	touch
};
