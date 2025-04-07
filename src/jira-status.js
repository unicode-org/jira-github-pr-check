// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

let jira;
if (process.env.JIRA_USERNAME && process.env.JIRA_PASSWORD) {
	jira = new (require("jira-connector"))({
		host: process.env.JIRA_URL,
		basic_auth: {
			username: process.env.JIRA_USERNAME,
			password: process.env.JIRA_PASSWORD
		}
	});
} else {
	jira = new (require("jira-connector"))({
		host: process.env.JIRA_URL,
	});
}

/** actually get status */
async function doGetStatus(issueKey) {
	return new Promise((resolve, reject) => {
		jira.issue.getIssue({
			issueKey
		}, (err, issue, response) => {
			if (err && err.errorMessages && /does not exist/.test(err.errorMessages[0])) {
				resolve(null);
			} else if (err) {
				if (response && response.statusCode) {
					reject(Error(`HTTP ${response.statusCode} ${response.statusMessage} on getIssue ${issueKey} - GET ${response.req.path}`, { cause: Error(response.body) }));
				} else {
					reject(err);
				}
			} else if (issue.fields) {
				resolve(issue);
			} else {
				resolve(null);
			}
		});
	});
}

/** wrapper with some retry */
async function getStatus(issueKey) {
	try {
		return await doGetStatus(issueKey); // if OK, return
	} catch(e) {
		console.error(`Error getting ${issueKey}: ${e.message} - will retry`);
		// try to retry - once
		const delay = (await import('delay')).default;
		await delay(5000);
		try {
			return await doGetStatus(issueKey); // if OK, return
		} catch(e2) {
			console.error(e2);
			throw e2;
		}
	}
}

function getUrl(issueKey) {
	return "https://" + process.env.JIRA_URL + "/browse/" + issueKey;
}

module.exports = {
	getStatus,
	getUrl
};
