import { registerHooks } from 'node:module'
const stub = new URL('./stub-base.mjs', import.meta.url).href
registerHooks({
	resolve(spec, ctx, next) {
		return spec === '@companion-module/base' ? { url: stub, shortCircuit: true } : next(spec, ctx)
	},
})
