// Multi-instance config (array form, ADR-0006): two independent services booted
// from one config, each on its own (ephemeral) port with its own inline routes.
export default [
  {
    name: 'users',
    port: 0,
    defaultCollection: 'happy',
    routes: [
      {
        id: 'users-route',
        method: 'GET',
        path: '/users/{id}',
        presets: { default: {} },
        variants: { success: { status: 200, body: { svc: 'users' } } },
      },
    ],
    collections: [{ id: 'happy', routes: ['users-route:default:success'] }],
  },
  {
    name: 'orders',
    port: 0,
    defaultCollection: 'happy',
    routes: [
      {
        id: 'orders-route',
        method: 'GET',
        path: '/orders/{id}',
        presets: { default: {} },
        variants: { success: { status: 200, body: { svc: 'orders' } } },
      },
    ],
    collections: [{ id: 'happy', routes: ['orders-route:default:success'] }],
  },
]
