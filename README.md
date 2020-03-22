Jira GitHub PR Checker
======================

A small webhook service that forces GitHub pull requests to have a valid, accepted Jira ticket in the title.

This service can be run on its own, and it is also designed with the capability to run as a GCP Cloud Function.

## Quick Start

To run as a server locally on the port given in the environment variable:

	$ node bin/server.js

If running as a GCP Cloud Function, set "app" as the "Function to execute" in the Cloud Functions settings page.  The server.js file will not be used; GCP will import the library function from app.js directly.

## PR Flags

The following "variables" can be set in the pull request body to change the behavior of the checker.

```
// Allow commits with mixed issue tags
DISABLE_JIRA_ISSUE_MATCH=true

// Allow multiple commits in the same PR
ALLOW_MANY_COMMITS=true
```

## Environment

The following environment variables are expected.  If a `.env` file is present, they will be read from there:

```
# Hostname of your Jira instance.
JIRA_URL=unicode-org.atlassian.net

# Authentication for your Jira instance.
# If not present, authentication for Jira will not be used.
#
# JIRA_USERNAME should be an *email address*, and JIRA_PASSWORD should be an
# API token generated at https://id.atlassian.com/manage/api-tokens
JIRA_USERNAME=foo@example.com
JIRA_PASSWORD=bar

# List of issue statuses that would be accepted
JIRA_APPROVED_STATUSES="Approved, Progress"

# URL prefix used for hyperlinks.
URL_PREFIX=http://localhost:3000

# Optional URL to your contribution guidelines; produces a link on the info page:
INSTRUCTIONS_URL=http://site.icu-project.org/processes/contribute

# Port to use when serving.
# Not required when used in Google Cloud Functions.
PORT=3000

# Optional GitHub secret; save the secret here and in the "secret" field when configuring the GitHub webhook:
GITHUB_WEBHOOK_SECRET=xxxxxxxxxx

# Committer name and email, used for squash commits.
# By default, use author as committer.
COMMITTER_NAME=Squash Bot
COMMITTER_EMAIL=foo@example.com

# Secret for the cookie session, used to store the user's GitHub access token in a cookie.
COOKIE_SECRET=xxxxxxxxxx

# Hostname of your GitHub instance
GITHUB_URL=https://github.mycompany.com/api/v3

# GitHub permissions:

# Option 1: Personal Access Token; easiest and useful for testing.
# Create one of these from https://github.com/settings/tokens
GITHUB_TOKEN=xxxxxxxxxx

# Option 2: GitHub App
# Create one of these from https://github.com/settings/apps
# If using an organization account, you can create the GitHub app there.
#
# GitHub App Permissions and Webhooks:
#  - Pull requests: Access: Read-only
#  - Commit statuses: Access: Read & write
#  - Subscribe to events: Pull request
#
# Find the ID (an integer) under "About" after you create the GitHub app.
# Find the Installation ID (another integer) in the URL after you add the app with permissions to your repositories.
GITHUB_APP_ID=12345
GITHUB_APP_INSTALLATION_ID=123456

# GitHub Apps use private keys for authentication to GitHub APIs.
# Choose 2a or 2b for how to specify your private key file, generated near the bottom of the GitHub app main information screen.

# 2a: PEM file path, relative to the repository root.
# The directory "keys" can be created; it is ignored by source control.
GITHUB_APP_PEM_FILE=keys/xyz.private-key.pem

# 2b: PEM as an environment variable blob.
# Encode the PEM file as base64 and save it in this environment variable.
GITHUB_APP_PEM_BLOB=LS0tLS1...

# In addition, you should make an OAuth App that can get user-by-user permissions to perform squash commits.
# Create one of these from https://github.com/settings/developers
# If using an organization account, you can create the OAuth app there.
GITHUB_OAUTH_CLIENT_ID=xxxxxxxxxx
GITHUB_OAUTH_CLIENT_SECRET=xxxxxxxxxx
```
