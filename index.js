module.exports = function (
  { afterBuild, _app: { graphql } },
  {appId, apiKey, collections, chunkSize = 1000, enablePartialUpdates = false }
) {
  const algoliasearch = require('algoliasearch');
  const chunk = require('lodash.chunk');

  /**
   * give back the same thing as this was called with.
   *
   * @param {any} item what to keep the same
   */
  const defaultTransformer = (item) => {
    return {
      objectID: item.id,
      title: item.title,
      slug: item.slug,
      modified: item.modified,
    };
  }

  const indexState = {}

  /**
   * Fetches all items for the current index from Algolia
   *
   * @param {AlgoliaIndex} index eg. client.initIndex('your_index_name');
   * @param {Array<String>} attributesToRetrieve eg. ['modified', 'slug']
   */
  function fetchAlgoliaObjects(index, attributesToRetrieve = ['modified']) {
    return new Promise((resolve, reject) => {
      /* Check if we havn't already fetched this index */
      const state = indexState[index.indexName]
      if (state && state.hits) return resolve(state.hits)

      const browser = index.browseAll('', { attributesToRetrieve });
      const hits = {};

      browser.on('result', (content) => {
        if (Array.isArray(content.hits)) {
          content.hits.forEach(hit => {
            hits[hit.objectID] = hit
          })
        }
      });
      browser.on('end', () => {
        state.hits = hits
        resolve(hits)
      });
      browser.on('error', (err) => reject(err) );
    });
  }

  async function getAlgoliaObjects(state, indexToUse, matchFields) {
    if (state.algoliaItems) return state.algoliaItems
    if (state._fetchingAlgoliaObjects) return state._fetchingAlgoliaObjects
    else {
      state._fetchingAlgoliaObjects = fetchAlgoliaObjects(indexToUse, matchFields)
      state.algoliaItems = await state._fetchingAlgoliaObjects
      delete(state._fetchingAlgoliaObjects)
      return state.algoliaItems
    }
  }

  afterBuild(async () => {

    const started = Date.now()

    const client = algoliasearch(appId, apiKey);

    const jobs = collections.map(async (
      { indexName, itemFormatter = defaultTransformer, contentTypeName, query, transformer, matchFields = ['modified'] },
      cIndex
    ) => {
      if (contentTypeName) throw new Error(`"contentTypeName" is no longer supported (Since version 2.x). Please update your code and remove "contentTypeName"`);
      if (!query || !transformer) throw new Error(`Algolia failed collection #${cIndex}: "query" and "transformer" required`);

      if (!Array.isArray(matchFields) || !matchFields.length) throw new Error(`Algolia failed ${cIndex}: matchFields required array of strings`);

      /* Use to keep track of what to remove afterwards */
      if (!indexState[indexName]) indexState[indexName] = {
        index: client.initIndex(indexName),
        checked: {}
      }
      const currentIndexState = indexState[indexName];

      const { index } = currentIndexState;
      /* Use temp index if main index already exists */
      let useTempIndex = false
      const indexToUse = await (async (_index) => {
        if (!enablePartialUpdates) {
          if (useTempIndex = await indexExists(_index)) {
            const tmpIndex = client.initIndex(`${indexName}_tmp`);
            await scopedCopyIndex(client, _index, tmpIndex);
            return tmpIndex;
          }
        }
        return _index
      })(index)

      console.log(`Algolia collection #${cIndex}: Executing query`);

      const result = await graphql(query);
      if (result.errors) {
        report.panic(`failed to index to Algolia`, result.errors);
      }

      const items = transformer(result).map(itemFormatter || ((item) => {
        item.objectID = item.objectID || item.id
        return item
      }))

      if (items.length > 0 && !items[0].objectID) {
        throw new Error(`Algolia failed collection #${cIndex}. Query results do not have 'objectID' key`);
      }

      console.log(`Algolia collection #${cIndex}: items in collection ${Object.keys(items).length}`);

      let hasChanged = items;
      if (enablePartialUpdates) {
        console.log(`Algolia collection #${cIndex}: starting Partial updates`);

        const algoliaItems = await getAlgoliaObjects(currentIndexState, indexToUse, matchFields);

        const results = algoliaItems ? Object.keys(algoliaItems).length : 0
        console.log(`Algolia collection #${cIndex}: found ${results} existing items`);

        if (results) {
          hasChanged = items.filter(curObj => {
            const {objectID} = curObj
            let extObj = currentIndexState.checked[objectID] = currentIndexState.checked[objectID] || algoliaItems[objectID]

            /* The object exists so we don't need to remove it from Algolia */
            delete(algoliaItems[objectID]);

            if (!extObj) return true;

            return !!matchFields.find(field => extObj[field] !== curObj[field]);
          });
        }

        console.log(`Algolia collection #${cIndex}: Partial updates – [insert/update: ${hasChanged.length}, total: ${items.length}]`);
      }

      const chunks = chunk(hasChanged, chunkSize);

      console.log(`Algolia collection #${cIndex}: splitting in ${chunks.length} jobs`);

      /* Add changed / new items */
      const chunkJobs = chunks.map(async function(chunked) {
        const { taskID } = await indexToUse.addObjects(chunked);
        return indexToUse.waitTask(taskID);
      });

      await Promise.all(chunkJobs);

      if (useTempIndex) {
        console.log(`Algolia collection #${cIndex}: moving copied index to main index`);
        return moveIndex(client, indexToUse, index);
      }
    });

    try {
      await Promise.all(jobs)

      if (enablePartialUpdates) {
        /* Execute once per index */
        /* This allows multiple queries to overlap */
        const cleanup = Object.keys(indexState).map(async function(indexName) {
          const { index, algoliaItems } = indexState[indexName];
          if (!algoliaItems) return
          const isRemoved = Object.keys(algoliaItems);

          if (isRemoved.length) {
            console.log(`Algolia: deleting ${isRemoved.length} items from ${indexName} index`);
            const { taskID } = await index.deleteObjects(isRemoved);
            return index.waitTask(taskID);
          }
        })

        await Promise.all(cleanup);
      }
    } catch (err) {
      throw new Error(`Algolia failed: ${err.message}`);
    }

    console.log(`Finished indexing to Algolia in ${Date.now() - started}ms`);
  })
}

/**
 * Copy the settings, synonyms, and rules of the source index to the target index
 * @param client
 * @param sourceIndex
 * @param targetIndex
 * @return {Promise}
 */
async function scopedCopyIndex(client, sourceIndex, targetIndex) {
  const { taskID } = await client.copyIndex(
    sourceIndex.indexName,
    targetIndex.indexName,
    ['settings', 'synonyms', 'rules']
  );
  return targetIndex.waitTask(taskID);
}

/**
 * moves the source index to the target index
 * @param client
 * @param sourceIndex
 * @param targetIndex
 * @return {Promise}
 */
async function moveIndex(client, sourceIndex, targetIndex) {
  const { taskID } = await client.moveIndex(
    sourceIndex.indexName,
    targetIndex.indexName
  );
  return targetIndex.waitTask(taskID);
}

/**
 * Does an Algolia index exist already
 *
 * @param index
 */
async function indexExists(index) {
  try {
    const { nbHits } = await index.search();
    return nbHits > 0;
  } catch (e) {
    return false;
  }
}
