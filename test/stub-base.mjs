// Minimal stand-in for @companion-module/base: records what the module sends to Companion
export const InstanceStatus = {
	Ok: 'ok',
	Connecting: 'connecting',
	ConnectionFailure: 'connection_failure',
	BadConfig: 'bad_config',
}
export const combineRgb = (r, g, b, a) =>
	((r << 16) | (g << 8) | b) + (a !== undefined && a >= 0 && a < 1 ? 0x1000000 * Math.round(255 * (1 - a)) : 0)
export const ButtonGraphicsShowStatusIcons = { FollowDefault: 'default', ShowAll: 'all', None: 'none' }
export const ButtonGraphicsDecorationType = {
	FollowDefault: 'default',
	TopBar: 'topbar',
	Border: 'border',
	None: 'none',
}
export class InstanceBase {
	constructor() {
		this.calls = []
		this.label = 'sb'
		this.vars = {}
	}
	#rec(name, ...args) {
		this.calls.push([name, ...args])
	}
	setActionDefinitions(d) {
		this.actions = d
		this.#rec('actions')
	}
	setFeedbackDefinitions(d) {
		this.feedbacks = d
		this.#rec('feedbacks')
	}
	setPresetDefinitions(s, p) {
		this.structure = s
		this.presets = p
		this.#rec('presets')
	}
	setVariableDefinitions(d) {
		this.varDefs = d
	}
	setVariableValues(v) {
		Object.assign(this.vars, v)
	}
	checkFeedbacks(...t) {
		this.#rec('checkFeedbacks', ...t)
	}
	checkAllFeedbacks() {
		this.#rec('checkAll')
	}
	checkFeedbacksById(...ids) {
		this.#rec('checkById', ...ids)
	}
	updateStatus(s, m) {
		this.status = [s, m]
		this.#rec('status', s, m)
	}
	saveConfig(c) {
		this.saved = structuredClone(c)
		this.#rec('saveConfig')
	}
	log(l, m) {
		if (process.env.VERBOSE) console.log(`  [${l}] ${m}`)
	}
}
