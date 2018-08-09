// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

const bodyParser = require("body-parser");
const express = require("express");

const github = require("./src/github-status");
const jira = require("./src/jira-status");

const JIRA_COMMIT_PATTERN = /^([A-Z]+-\d+)[:\s].*$/;

const app = express()
	.use(bodyParser.json())
	.use(bodyParser.urlencoded({ extended: false }))
	.post("/hook", async (req, res) => {
		try {
			const payload = JSON.parse(req.body.payload);
			const match = JIRA_COMMIT_PATTERN.exec(payload.pull_request.title);
			if (!match) {
				console.log("No Jira ticket found:", payload.pull_request.title);
				await github.createStatus(payload.pull_request, false, undefined, "Pull request title must start with a Jira ticket ID");
				return res.sendStatus(204);
			}
			const issueKey = match[1];
			const jiraStatus = await jira.getStatus(issueKey);
			console.log("Jira ticket", issueKey, "has status", jiraStatus);
			// TODO: Allow statuses like Reviewing and Review Feedback
			const pass = (jiraStatus === "Accepted");
			const description = pass ? "Jira ticket " + issueKey + " is accepted" : jiraStatus === null ? "Jira ticket " + issueKey + " not found" : "Jira ticket " + issueKey + " is not accepted; it has status " + jiraStatus;
			await github.createStatus(payload.pull_request, pass, jira.getUrl(issueKey), description);
			return res.sendStatus(204);
		} catch (err) {
			console.error(err);
			return res.sendStatus(500);
		}
	});

module.exports = (req, res) => {
	return app(req, res);
};
