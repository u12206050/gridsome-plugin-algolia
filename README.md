
[![npm version](https://badge.fury.io/js/gridsome-plugin-algolia.svg)](https://www.npmjs.com/package/gridsome-plugin-algolia)

# Gridsome plugin Algolia

A gridsome plugin to index objects to Algolia

> Ported from [gatsby-plugin-algolia](https://github.com/algolia/gatsby-plugin-algolia)

You can specify a list of collections to run and how to transform them into an array of objects to index. When you run `gridsome build`, it will publish those to Algolia.

Here we have an example with some data that might not be very relevant, but will work with the default configuration of `gridsome new`


**BREAKING CHANGES FROM VERSION 1.x: Read Below**

## Install
* `yarn add gridsome-plugin-algolia`
* `npm install gridsome-plugin-algolia -S`


## Setup

First add credentials to a .env file, which you won't commit. If you track this in your file, and especially if the site is open source, you will leak your admin API key. This would mean anyone is able to change anything on your Algolia index.

```
// DEVELOPING: .env.development
// BUILDING: .env.production

ALGOLIA_APP_ID=XXX
ALGOLIA_ADMIN_KEY=XXX
ALGOLIA_INDEX_NAME=XXX
```

## Usage

```javascript:title=gridsome-config.js
// gridsome-config.js

const collections = [
  {
    query: `{
      allBlogPost {
        edges {
          node {
            id
            title
            slug
            modified
          }
        }
      }
    }`,
    transformer: ({ data }) => data.allBlogPost.edges.map(({ node }) => node)
    indexName: process.env.ALGOLIA_INDEX_NAME || 'posts', // Algolia index name
    itemFormatter: (item) => {
      return {
        objectID: item.id,
        title: item.title,
        slug: item.slug,
        modified: String(item.modified)
      }
    }, // optional
    matchFields: ['slug', 'modified'], // Array<String> required with PartialUpdates
  },
];

module.exports = {
  plugins: [
    {
      use: `gridsome-plugin-algolia`,
      options: {
        appId: process.env.ALGOLIA_APP_ID,
        apiKey: process.env.ALGOLIA_ADMIN_KEY,
        collections,
        chunkSize: 10000, // default: 1000
        enablePartialUpdates: true, // default: false
      },
    },
  ],
};
```

### Partial Updates

By default all items will be reindexed on every build. To enable only indexing new, changed and deleted items, set `enablePartialUpdates` to `true` and make sure `matchFields` is correct for every collection.

## Migrating from Version 1 to Version 2

The `contentTypeName` field in `collections` has been replaced in favor of `query` and `transformer`. This is to allow greater control over what data you want to fetch from GraphQL before indexing to Algolia.

To migrate the least you should do is the following:

  1. Remove the `contentTypeName` property
  2. Add the `query` property containing a plain graphql query to fetch the data you need
  3. Add the `transformer` property with a function as value to map the result to a set of items. (**Note**: The `itemFormatter` function will still be called)

## QnA

**Q** Partial updates not working? All items being reindexed everytime.

**A**
* Make sure that the fields you use to compare are either `Strings` or `Numbers`. *Dates* for example are converted to String when pushed to Algolia so they won't match unless you first convert the Date to a string eg.
* Make sure each object has a unique `id` that you map to `objectID`

```
    itemFormatter: (item) => {
      return {
        objectID: item.id, // Unique id
        title: item.title,
        slug: item.slug,
        modified: String(item.modified) // Date converted to string
      }
    }
```
