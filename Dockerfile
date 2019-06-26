FROM node:10

ENV NODE_ENV production

# run CI first (caching)
COPY package-lock.json package.json /usr/src/app/
WORKDIR /usr/src/app
RUN npm ci

# VOLUMEs here
EXPOSE 3000

# copy actual app
COPY . /usr/src/app/
CMD npm start

# Local Variables:
# docker-image-name: "unicode-pr-check"
