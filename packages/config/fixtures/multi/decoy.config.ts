// Multi-instance config (array form, ADR-0006): two independent services, each on
// its own port with its own inline routes/collections. Loaded via jiti at test
// time, so it stays a plain default export (no `@decoy/config` self-import).
export default [
  {
    name: 'users',
    port: 4501,
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
    port: 4502,
    defaultCollection: 'happy',
    passthrough: { url: 'https://orders.real/' },
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
