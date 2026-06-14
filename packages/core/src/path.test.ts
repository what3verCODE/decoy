import { describe, expect, test } from '@rstest/core'
import { compilePath, matchPath } from './path'

describe('compilePath / matchPath', () => {
  test('matches a literal path', () => {
    const compiled = compilePath('/users')
    expect(matchPath(compiled, '/users')).toEqual({})
    expect(matchPath(compiled, '/orders')).toBeNull()
  })

  test('extracts OpenAPI {id} params', () => {
    const compiled = compilePath('/users/{id}')
    expect(matchPath(compiled, '/users/42')).toEqual({ id: '42' })
    expect(matchPath(compiled, '/users')).toBeNull()
    expect(matchPath(compiled, '/users/42/posts')).toBeNull()
  })

  test('extracts multiple params', () => {
    const compiled = compilePath('/users/{userId}/posts/{postId}')
    expect(matchPath(compiled, '/users/1/posts/2')).toEqual({ userId: '1', postId: '2' })
  })

  test('tolerates a trailing slash', () => {
    const compiled = compilePath('/users/{id}')
    expect(matchPath(compiled, '/users/42/')).toEqual({ id: '42' })
  })

  test('does not treat dots as wildcards', () => {
    const compiled = compilePath('/v1.0/users')
    expect(matchPath(compiled, '/v1.0/users')).toEqual({})
    expect(matchPath(compiled, '/v1X0/users')).toBeNull()
  })
})
