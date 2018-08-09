Jira GitHub PR Checker
======================

A small webhook service that forces GitHub pull requests to have a valid, accepted Jira ticket in the title.

This is designed to be able to be run as a GCP Cloud Function.

## Quick Start

To run as a server locally on the port given in the environment variable:

	$ node server.js

Use the app.js endpoint for GCP Cloud Functions.

## Environment

The following environment variables are expected.  If a `.env` file is present, they will be read from there:

- JIRA_URL (for example, unicode-org.atlassian.net)
- PORT (for example, 3000)
- either GITHUB_TOKEN (created from your account)
- or GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET
