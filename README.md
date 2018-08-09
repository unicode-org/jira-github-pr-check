Jira GitHub PR Checker
======================

A small webhook service that forces GitHub pull requests to have a valid, accepted Jira ticket in the title.

This is designed to be able to be run as a GCP Cloud Function.

## Environment

The following environment variables are expected.  If a `.env` file is present, they will be read from there:

- JIRA_URL (for example, unicode-org.atlassian.net)
- PORT (for example, 3000)
- GITHUB_TOKEN (created from your account)
- GITHUB_OWNER (for example, unicode-org)
- GITHUB_REPO (for example, icu)
