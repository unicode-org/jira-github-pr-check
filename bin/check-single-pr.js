#!/usr/bin/env node
// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

require("dotenv").config();

const app = require("../app");
const pullRequest = JSON.parse(require("fs").readFileSync("/dev/stdin").toString());

app.getJiraInfo(pullRequest).then((jiraInfo) => {
	app.touch(pullRequest, jiraInfo).then(() => {
		console.log("Done");
		process.exit(0);
	}).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}).catch((err) => {
	console.error(err);
	process.exit(1);
});
