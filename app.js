// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const crypto = require("crypto");
const express = require("express");
const morgan = require("morgan");

const github = require("./src/github-status");
const jira = require("./src/jira-status");
const githubUser = require("./src/github-user");

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

function makeViewUrl(endpoint, params) {
	return `${process.env.URL_PREFIX}/${endpoint}/${params.owner}/${params.repo}/${params.pull_number}`;
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
			pull_number: pullRequest.number
		})
	]);
	const jiraStatus = jiraIssue && jiraIssue.fields.status.name;
	const jiraSummary = jiraIssue && jiraIssue.fields.summary;
	const numCommits = commits.length;
	const isMaintMerge = ((pullRequest.base.ref === "master" || pullRequest.base.ref === "main")
		&& pullRequest.head.ref.match(/^maint\//)
		&& pullRequest.base.repo.full_name == pullRequest.head.repo.full_name);
	let jiraApprovedStatuses = process.env.JIRA_APPROVED_STATUSES || "Accepted, Reviewing, Review Feedback"
	const jiraApprovedStatusesArray = jiraApprovedStatuses.split(",").map(status => status.trim())

	// Check Jira ticket for validity
	if (!jiraApprovedStatuses.includes(jiraStatus) && process.env.JIRA_STATUS_CHECK === "TRUE") {
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
	if(process.env.SEARCH_JIRA_ISSUE_IN_COMMIT === "TRUE") {
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
					description: "Commit " + commitInfo.sha.substr(0, 7) + " is for " + commitIssueKey + ", but the PR is for " + issueKey,
					extendedDescription: "Please fix your commit message to have the same ticket number as the pull request. If the inconsistency is intentional, you can disable this warning with DISABLE_JIRA_ISSUE_MATCH=true in the PR description.",
					badCommit: commitInfo
				};
			}
		}
	}


	// Since we can't easily check more than 100 commits, reject PRs with more than 100 commits
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
		description: issueKey + " \u201C" + jiraSummary + "\u201D"
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
	const pull_number = pullRequest.number;
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
	return github.postComment({ owner, repo, issue_number: pull_number, body });
}

const DO_NOT_TOUCH_REPOS = (process.env.DO_NOT_TOUCH_REPOS || "").split(",");

async function touch(pullRequest, jiraInfo) {
	const owner = pullRequest.base.repo.owner.login;
	const repo = pullRequest.base.repo.name;
	if (DO_NOT_TOUCH_REPOS.indexOf(owner + "/" + repo) !== -1) {
		console.log("Not touching: repo is " + owner + "/" + repo);
		return;
	}
	const pull_number = pullRequest.number;
	const state = pullRequest.state;
	if (state !== "open") {
		console.log("Not touching: PR is " + state + ": " + pull_number);
		return;
	}
	const url = makeViewUrl("info", { owner, repo, pull_number });
	const multiCommitPass = jiraInfo.numCommits === 1
		|| (jiraInfo.numCommits > 1 && (jiraInfo.isMaintMerge || jiraInfo.prFlags["ALLOW_MANY_COMMITS"]));
	const multiCommitMessage = (jiraInfo.numCommits === 0) ? "No commits found on PR" : (jiraInfo.numCommits === 1) ? "This PR includes exactly 1 commit!" : "This PR has " + jiraInfo.numCommits + " commits" + (multiCommitPass ? "" : "; consider squashing:");
	const promises = [
		github.createStatus("jira-ticket", pullRequest, jiraInfo.pass, url, jiraInfo.description),
	];

	if (!(process.env.ALLOW_MANY_COMMITS === "TRUE")) {
		promises.push(github.createStatus("single-commit", pullRequest, multiCommitPass, undefined, multiCommitMessage))
	}

	if (jiraInfo.isMaintMerge) {
		promises.push(github.createStatus("maint-merge", pullRequest, false, undefined, "Reminder: use a MERGE COMMIT and new ticket in the message."));
	}
	return Promise.all(promises);
}

async function squash(req) {
	const pullRequest = await github.getPullRequest(req.body);
	const owner = pullRequest.head.repo.owner.login;
	const repo = pullRequest.head.repo.name;
	const ref = "heads/" + pullRequest.head.ref;
	const parentSha = pullRequest.base.sha;
	const headSha = pullRequest.head.sha;
	const message = req.body.title + "\n\n" + req.body.description;
	const githubToken = req.session["gh_user"];
	if (!githubToken) {
		console.error("Null github token!");
		return;
	}
	const commitData = await github.writeSquashCommit(githubToken, {
		owner,
		repo,
		parentSha,
		headSha,
		message
	});
	await github.writeBranch(githubToken, {
		owner,
		repo,
		ref,
		sha: commitData.sha,
		force: true
	});
}

const COOKIE_SECRET = process.env.COOKIE_SECRET || Math.random().toString(36).substr(2, 15);

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
	.use(cookieSession({ secret: COOKIE_SECRET }))
	.use(morgan("tiny"))
	.get("/info/:owner/:repo/:pull_number", async (req, res) => {
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
				instructionsUrl: process.env.INSTRUCTIONS_URL,
				squashUrl: makeViewUrl("squash", req.params),
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
	.post("/touch/:owner/:repo/:pull_number", async (req, res) => {
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
	.get("/squash/:owner/:repo/:pull_number", async (req, res) => {
		if (!req.session["gh_user"]) {
			// Authorize GitHub first
			const { url, state } = githubUser.createGithubLoginUrl();
			req.session["gh_state"] = state;
			req.session["redirect"] = process.env.URL_PREFIX + req.originalUrl;
			return res.redirect(url);
		}
		try {
			// Continue to Squash UI
			const pullRequest = await github.getPullRequest(req.params);
			const jiraInfo = await getJiraInfo(pullRequest);
			return res.render("squash.ejs", {
				params: req.params,
				pullRequest,
				jiraInfo,
				checkerGithubUrl: require("./package.json").repository.url,
				errorCode: req.query.code,
			});
		} catch (err) {
			console.error(err);
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				return res.sendStatus(500);
			}
		}
	})
	.get("/github-auth", async (req, res) => {
		if (req.query.state !== req.session["gh_state"]) {
			// Unexpected state
			return res.sendStatus(400);
		}
		try {
			// Exchange code for an OAuth token
			const redirectTo = req.session["redirect"];
			const token = await githubUser.getToken(req.query);
			req.session["gh_user"] = token;
			delete req.session["gh_state"];
			delete req.session["redirect"];
			return res.redirect(redirectTo);
		} catch (err) {
			console.error(err);
			if (err.code) {
				return res.sendStatus(err.code);
			} else {
				return res.sendStatus(500);
			}
		}
	})
	.post("/do-squash", async (req, res) => {
		if (!req.session["gh_user"]) {
			// Unexpected state
			return res.sendStatus(400);
		}
		try {
			if (!req.body.confirm) {
				return res.status(422).send("Please check the confirmation box!");
			}
			await squash(req);
			return res.redirect(makeViewUrl("info", req.body));
		} catch (err) {
			if (err.code) {
				// If this failed gracefully, send the user to the GitHub login flow. The token could be expired or deactivated or have the wrong scopes.
				delete req.session["gh_user"];
				return res.redirect(makeViewUrl("squash", req.body) + "?code=" + err.code);
			} else {
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
