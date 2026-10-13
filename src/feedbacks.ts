import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type NowPlayingSource = 'auto' | 'sound' | 'stream'

export type FeedbacksSchema = {
	cover: { type: 'advanced'; options: { sound: string } }
	cover_image: { type: 'value'; options: { sound: string }; result: string }
	playing: { type: 'boolean'; options: { sound: string } }
	any_playing: { type: 'boolean'; options: Record<string, never> }
	now_playing_cover: { type: 'advanced'; options: { source: string } }
}

const NOW_PLAYING_SOURCES = [
	{ id: 'auto', label: 'Sound, else web stream' },
	{ id: 'sound', label: 'Sound file only' },
	{ id: 'stream', label: 'Web stream only' },
]

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		cover: {
			type: 'advanced',
			name: 'Sound cover art',
			description:
				'Shows the cover embedded in the sound file as button image. Updates when the cover changes; cached while the soundboard is offline.',
			options: [self.soundOption('Sound')],
			affectedProperties: ['png64'],
			callback: (feedback) => {
				const name = String(feedback.options.sound ?? '')
				self.useSound(`feedback:${feedback.id}`, name)
				const cover = self.coverFor(name)
				return cover ? { png64: cover } : {}
			},
			unsubscribe: (feedback) => {
				self.releaseSound(`feedback:${feedback.id}`)
			},
		},
		cover_image: {
			type: 'value',
			name: 'Sound cover art (image data)',
			description:
				'Base64 image data of the cover, for an image element on layered buttons. Empty when the sound has no cover.',
			options: [self.soundOption('Sound')],
			callback: (feedback) => {
				const name = String(feedback.options.sound ?? '')
				self.useSound(`feedback:${feedback.id}`, name)
				return self.coverFor(name) ?? ''
			},
			unsubscribe: (feedback) => {
				self.releaseSound(`feedback:${feedback.id}`)
			},
		},
		playing: {
			type: 'boolean',
			name: 'Sound is playing',
			description: 'True while this sound is the newest sound still playing',
			options: [self.soundOption('Sound')],
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(0, 204, 0),
			},
			callback: (feedback) => self.nowPlaying?.sound?.name === String(feedback.options.sound ?? ''),
		},
		any_playing: {
			type: 'boolean',
			name: 'Anything is playing',
			options: [],
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(204, 0, 0),
			},
			callback: () => self.anyPlaying,
		},
		now_playing_cover: {
			type: 'advanced',
			name: 'Now playing cover art',
			description: 'Cover of the sound that is playing, or the thumbnail of the running web stream',
			options: [
				{
					type: 'dropdown',
					id: 'source',
					label: 'Show',
					default: 'auto',
					choices: NOW_PLAYING_SOURCES,
				},
			],
			affectedProperties: ['png64'],
			callback: (feedback) => {
				const image = self.nowPlayingImage(String(feedback.options.source ?? 'auto') as NowPlayingSource)
				return image ? { png64: image } : {}
			},
		},
	})
}
