import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const config = await generateEslintConfig({
	enableTypescript: true,
})

// test/ is a dev-only harness (module loader hooks, fake server), not part of the packaged module
export default [...config, { ignores: ['test/**'] }]
