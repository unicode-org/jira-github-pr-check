// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const bodyParser = require("body-parser");
const express = require("express");
const morgan = require("morgan");

const github = require("./src/github-status");
const jira = require("./src/jira-status");

const JIRA_COMMIT_PATTERN = /^([A-Z]+-\d+)[:\s].*$/;

async function getJiraInfo(pullRequest) {
	const match = JIRA_COMMIT_PATTERN.exec(pullRequest.title);
	if (!match) {
		return {
			issueKey: null,
			pass: false,
			description: "Pull request title must start with a Jira ticket ID"
		};
	}
	const issueKey = match[1];
	const jiraStatus = await jira.getStatus(issueKey);
	const pass = (jiraStatus === "Accepted" || jiraStatus === "Reviewing" || jiraStatus === "Review Feedback");
	const description = pass ? "Jira ticket " + issueKey + " has status " + jiraStatus : jiraStatus === null ? "Jira ticket " + issueKey + " not found" : "Jira ticket " + issueKey + " is not accepted; it has status " + jiraStatus;
	return { issueKey, jiraStatus, pass, description };
}

async function touch(pullRequest, jiraInfo) {
	const owner = pullRequest.base.repo.owner.login;
	const repo = pullRequest.base.repo.name;
	const number = pullRequest.number;
	const url = process.env.URL_PREFIX + "/info/" + owner + "/" + repo + "/" + number;
	await github.createStatus(pullRequest, jiraInfo.pass, url, jiraInfo.description);
}

const app = express()
	.use(bodyParser.json())
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
				jiraUrl: jiraInfo.issueKey ? jira.getUrl(jiraInfo.issueKey) : undefined
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
	.post("/hook", async (req, res) => {
		try {
			const pullRequest = req.body.pull_request;
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
	});

module.exports = {
	app: (req, res) => {
		return app(req, res);
	},
	getJiraInfo,
	touch
};
