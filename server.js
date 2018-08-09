// © 2016 and later: Unicode, Inc. and others.
// License & terms of use: http://www.unicode.org/copyright.html#License

"use strict";

require("dotenv").config();

const app = require("./app");
const http = require("http");

const server = http.createServer(app);
server.listen(process.env.PORT);
console.log("Listening on port", process.env.PORT);
