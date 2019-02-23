# Gridsome plugin Algolia
A gridsome plugin to index objects to Algolia

> Ported from [gatsby-plugin-algolia](https://github.com/algolia/gatsby-plugin-algolia)

You can specify a list of collections to run and how to transform them into an array of objects to index. When you run `gridsome build`, it will publish those to Algolia.

Here we have an example with some data that might not be very relevant, but will work with the default configuration of `gridsome new`


## Install
* `yarn add gridsome-plugin-algolia`
* `npm install gridsome-plugin-algolia -S`


## Setup

First add credentials to a .env file, which you won't commit. If you track this in your file, and especially if the site is open source, you will leak your admin API key. This would mean anyone is able to change anything on your Algolia index.

```env
// .env.production
ALGOLIA_APP_ID=XXX
ALGOLIA_APP_KEY=XXX
ALGOLIA_INDEX_NAME=XXX
```

## Usage

```javascript:title=gridsome-config.js

require('dotenv').config({
  path: `.env.${process.env.NODE_ENV}`,
})

// gridsome-config.js

const collections = [
  {
    contentTypeName: 'BlogPost',
    indexName: 'posts', // Algolia index name
    itemFormatter: (item) => {
      return { objectID: item.id, title: item.title, slug: item.slug, modified: item.modified };
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
        apiKey: process.env.ALGOLIA_API_KEY,
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
