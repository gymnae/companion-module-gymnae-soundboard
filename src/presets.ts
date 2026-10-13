import {
	ButtonGraphicsDecorationType,
	combineRgb,
	type CompanionPresetDefinitions,
	type CompanionPresetSection,
} from '@companion-module/base'
import { displayName } from './cache.js'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const TRANSPARENT = combineRgb(0, 0, 0, 0)
const PLAYING = combineRgb(0, 255, 0)
/** Percent of the element height; matches the 14pt text of the simple variant */
const LABEL_SIZE = 23
/** Percent of the button size, about 3 px on a 72 px button */
const FRAME_WIDTH = 4

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const soundIds: string[] = []

	for (const sound of self.cache.sorted(self.config.sort, self.config.names)) {
		const id = `sound:${sound.name}`
		const label = displayName(sound, self.config.names)
		soundIds.push(id)
		const keywords = [sound.name, sound.artist, sound.album].filter((k): k is string => !!k)
		// The cover feedback also hides the text once a cover loads, for sounds that get one later
		const text = sound.has_cover ? '' : label
		const steps = [{ down: [{ actionId: 'play' as const, options: { sound: sound.name } }], up: [] }]
		presets[id] = {
			type: 'alternatives',
			variants: [
				{
					// Layered: a green frame drawn over the cover while the sound plays
					type: 'layered',
					name: label,
					keywords,
					canvas: { decoration: ButtonGraphicsDecorationType.None },
					elements: [
						{ id: 'background', name: 'Background', type: 'box', color: BLACK },
						{ id: 'cover', name: 'Cover', type: 'image', base64Image: null, fillMode: 'fit' },
						{
							id: 'label',
							name: 'Name',
							type: 'text',
							text,
							fontsize: LABEL_SIZE,
							fontsizeAllowShrink: true,
							color: WHITE,
							halign: 'center',
							valign: 'bottom',
						},
						{
							id: 'frame',
							name: 'Playing frame',
							type: 'box',
							enabled: false,
							color: TRANSPARENT,
							borderWidth: FRAME_WIDTH,
							borderColor: PLAYING,
							borderPosition: 'inside',
						},
					],
					steps,
					feedbacks: [
						{
							feedbackId: 'cover',
							options: { sound: sound.name, hide_text: true },
							styleOverrides: [
								{ elementId: 'cover', elementProperty: 'base64Image', override: 'png64' },
								{ elementId: 'label', elementProperty: 'text', override: 'text' },
							],
						},
						{
							feedbackId: 'playing',
							options: { sound: sound.name },
							styleOverrides: [{ elementId: 'frame', elementProperty: 'enabled', override: true }],
						},
					],
				},
				{
					// For hosts without layered buttons: no frame possible, so the text turns green with a ▶
					type: 'simple',
					name: label,
					keywords,
					style: {
						text,
						size: '14',
						color: WHITE,
						bgcolor: BLACK,
						alignment: 'center:bottom',
						pngalignment: 'center:center',
						show_topbar: false,
					},
					steps,
					feedbacks: [
						{ feedbackId: 'cover', options: { sound: sound.name, hide_text: true } },
						{
							feedbackId: 'playing',
							options: { sound: sound.name },
							style: { color: PLAYING, text: sound.has_cover ? '▶' : `▶ ${label}` },
						},
					],
				},
			],
		}
	}

	presets['stop'] = {
		type: 'simple',
		name: 'Stop all',
		style: { text: 'STOP', size: '24', color: WHITE, bgcolor: combineRgb(102, 0, 0), show_topbar: false },
		steps: [{ down: [{ actionId: 'stop', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'any_playing', options: {}, style: { bgcolor: combineRgb(204, 0, 0) } }],
	}
	presets['now_playing'] = {
		type: 'simple',
		name: 'Now playing (press to stop)',
		style: {
			text: `$(${self.label}:now_playing_title)`,
			size: '7',
			color: WHITE,
			bgcolor: BLACK,
			alignment: 'center:bottom',
			pngalignment: 'center:center',
			show_topbar: false,
		},
		steps: [{ down: [{ actionId: 'stop', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'now_playing_cover', options: { source: 'auto' } }],
	}
	presets['refresh'] = {
		type: 'simple',
		name: 'Refresh sounds',
		style: { text: 'Refresh\nsounds', size: '14', color: WHITE, bgcolor: combineRgb(0, 0, 102), show_topbar: false },
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [],
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'sounds',
			name: 'Sounds',
			description:
				soundIds.length > 0
					? `${soundIds.length} sounds, ordered ${self.config.sort === 'plays' ? 'by number of plays' : 'alphabetically'}`
					: 'No sounds known yet – check the soundboard address',
			definitions: soundIds,
		},
		{
			id: 'control',
			name: 'Control',
			definitions: ['stop', 'now_playing', 'refresh'],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
