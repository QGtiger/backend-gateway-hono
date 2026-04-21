import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

console.log(process.env.PORT, process.env.NODE_ENV)

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT) || 3000
  console.log(`Server is running on port ${port}`)
  serve({
    fetch: app.fetch,
    port
  })
}

export default app