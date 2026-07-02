// Monolith router for the vocab HTTP API. Plain ESM, no build step —
// the AWS SDK v3 comes with the Node.js 20 Lambda runtime.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'

const TABLE = process.env.TABLE_NAME
const API_KEY = process.env.API_KEY

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function queryAll(pk) {
  const items = []
  let lastKey
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  // Strip the key attributes; the payload is the domain object.
  return items.map(({ pk: _pk, sk: _sk, ...rest }) => rest)
}

export async function handler(event) {
  if (event.headers?.['x-api-key'] !== API_KEY) {
    return json(401, { error: 'invalid api key' })
  }

  const id = event.pathParameters?.id
  const body = event.body ? JSON.parse(event.body) : undefined

  switch (event.routeKey) {
    case 'GET /words':
      return json(200, await queryAll('WORD'))

    case 'PUT /words/{id}': {
      if (!body || body.id !== id) return json(400, { error: 'body.id must match path id' })
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: 'WORD', sk: id, ...body } }))
      return json(200, { ok: true })
    }

    case 'DELETE /words/{id}': {
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: 'WORD', sk: id } }))
      await doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk: 'PROGRESS', sk: id } }))
      return json(200, { ok: true })
    }

    case 'GET /progress':
      return json(200, await queryAll('PROGRESS'))

    case 'PUT /progress/{id}': {
      if (!body || body.wordId !== id) return json(400, { error: 'body.wordId must match path id' })
      await doc.send(new PutCommand({ TableName: TABLE, Item: { pk: 'PROGRESS', sk: id, ...body } }))
      return json(200, { ok: true })
    }

    case 'POST /seed': {
      // Bulk upsert of words (from french-app/scripts/seed-remote.mjs).
      if (!Array.isArray(body?.words)) return json(400, { error: 'body.words must be an array' })
      const puts = body.words.map((w) => ({ PutRequest: { Item: { pk: 'WORD', sk: w.id, ...w } } }))
      for (let i = 0; i < puts.length; i += 25) {
        await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: puts.slice(i, i + 25) } }))
      }
      return json(200, { ok: true, count: body.words.length })
    }

    default:
      return json(404, { error: `no route: ${event.routeKey}` })
  }
}
