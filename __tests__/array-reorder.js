"use strict"
import {
	enableArrayMethods,
	enablePatches,
	createDraft,
	finishDraft,
	produce,
	applyPatches,
	Immer
} from "../src/immer"

enablePatches()
enableArrayMethods()

// Regression tests for mutating array methods (sort/reverse and shifting
// methods like splice/unshift) that reorder *existing* base elements.
//
// Such operations run against the draft's internal copy, so afterwards a slot
// can hold an original base object that used to live at another index. Indexed
// access to those slots must still return a draft proxy; otherwise user code
// mutates the frozen original state, and patches (in particular inverse
// patches) get corrupted.
//
// See: draft interception of relocated base elements after sort/reverse.

function createState() {
	return {
		items: [
			{id: 3, mark: "a"},
			{id: 1, mark: "b"},
			{id: 2, mark: "c"}
		]
	}
}

describe("array reorder regression - produce", () => {
	it("sort does not leak mutations into the original state", () => {
		const state = createState()
		const itemsRef = state.items
		const baseSnapshot = JSON.stringify(state)

		const nextState = produce(state, draft => {
			draft.items.sort((a, b) => a.id - b.id)
			draft.items[0].mark = "X"
		})

		// The original state is untouched in identity and contents.
		expect(state.items).toBe(itemsRef)
		expect(JSON.stringify(state)).toBe(baseSnapshot)

		expect(nextState).not.toBe(state)
		expect(nextState.items).toEqual([
			{id: 1, mark: "X"},
			{id: 2, mark: "c"},
			{id: 3, mark: "a"}
		])
	})

	it("reverse does not leak mutations into the original state", () => {
		const state = createState()
		const itemsRef = state.items
		const baseSnapshot = JSON.stringify(state)

		const nextState = produce(state, draft => {
			draft.items.reverse()
			draft.items[0].mark = "X"
		})

		expect(state.items).toBe(itemsRef)
		expect(JSON.stringify(state)).toBe(baseSnapshot)

		expect(nextState.items).toEqual([
			{id: 2, mark: "X"},
			{id: 1, mark: "b"},
			{id: 3, mark: "a"}
		])
	})

	it("emits correct patches and inverse patches for sort + edit", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)
		let patches, inversePatches

		const nextState = produce(
			state,
			draft => {
				draft.items.sort((a, b) => a.id - b.id)
				draft.items[0].mark = "X"
			},
			(p, ip) => {
				patches = p
				inversePatches = ip
			}
		)

		expect(patches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 1, mark: "X"}},
			{op: "replace", path: ["items", 1], value: {id: 2, mark: "c"}},
			{op: "replace", path: ["items", 2], value: {id: 3, mark: "a"}}
		])
		expect(inversePatches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 3, mark: "a"}},
			{op: "replace", path: ["items", 1], value: {id: 1, mark: "b"}},
			{op: "replace", path: ["items", 2], value: {id: 2, mark: "c"}}
		])

		// Inverse patches restore the pristine base ...
		const restored = produce(state, draft =>
			applyPatches(draft, inversePatches)
		)
		expect(JSON.stringify(restored)).toBe(baseSnapshot)
		// ... and the forward patches reproduce the next state.
		const replayed = produce(state, draft => applyPatches(draft, patches))
		expect(replayed).toEqual(nextState)
	})

	it("emits correct patches and inverse patches for reverse + edit", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)
		let patches, inversePatches

		const nextState = produce(
			state,
			draft => {
				draft.items.reverse()
				draft.items[0].mark = "X"
			},
			(p, ip) => {
				patches = p
				inversePatches = ip
			}
		)

		expect(patches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 2, mark: "X"}},
			{op: "replace", path: ["items", 2], value: {id: 3, mark: "a"}}
		])
		// The inverse patch must report the *original* "c" value, proving the
		// mutation never reached base item {id: 2}.
		expect(inversePatches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 3, mark: "a"}},
			{op: "replace", path: ["items", 2], value: {id: 2, mark: "c"}}
		])

		const restored = produce(state, draft =>
			applyPatches(draft, inversePatches)
		)
		expect(JSON.stringify(restored)).toBe(baseSnapshot)
		expect(produce(state, draft => applyPatches(draft, patches))).toEqual(
			nextState
		)
	})
})

describe("array reorder regression - createDraft/finishDraft", () => {
	it("sort keeps the original state intact and finishes correctly", () => {
		const state = createState()
		const itemsRef = state.items
		const baseSnapshot = JSON.stringify(state)

		const draft = createDraft(state)
		draft.items.sort((a, b) => a.id - b.id)
		draft.items[0].mark = "X"
		const nextState = finishDraft(draft)

		expect(state.items).toBe(itemsRef)
		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextState.items).toEqual([
			{id: 1, mark: "X"},
			{id: 2, mark: "c"},
			{id: 3, mark: "a"}
		])
	})

	it("reverse keeps the original state intact and finishes correctly", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)

		const draft = createDraft(state)
		draft.items.reverse()
		draft.items[0].mark = "X"
		const nextState = finishDraft(draft)

		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextState.items).toEqual([
			{id: 2, mark: "X"},
			{id: 1, mark: "b"},
			{id: 3, mark: "a"}
		])
	})

	it("finishDraft reports correct patches and inverse patches (sort)", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)
		let patches, inversePatches

		const draft = createDraft(state)
		draft.items.sort((a, b) => a.id - b.id)
		draft.items[0].mark = "X"
		const nextState = finishDraft(draft, (p, ip) => {
			patches = p
			inversePatches = ip
		})

		expect(patches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 1, mark: "X"}},
			{op: "replace", path: ["items", 1], value: {id: 2, mark: "c"}},
			{op: "replace", path: ["items", 2], value: {id: 3, mark: "a"}}
		])
		expect(inversePatches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 3, mark: "a"}},
			{op: "replace", path: ["items", 1], value: {id: 1, mark: "b"}},
			{op: "replace", path: ["items", 2], value: {id: 2, mark: "c"}}
		])
		expect(JSON.stringify(state)).toBe(baseSnapshot)

		expect(
			produce(state, draft => applyPatches(draft, inversePatches))
		).toEqual(JSON.parse(baseSnapshot))
		expect(produce(state, draft => applyPatches(draft, patches))).toEqual(
			nextState
		)
	})

	it("finishDraft reports correct patches and inverse patches (reverse)", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)
		let patches, inversePatches

		const draft = createDraft(state)
		draft.items.reverse()
		draft.items[0].mark = "X"
		const nextState = finishDraft(draft, (p, ip) => {
			patches = p
			inversePatches = ip
		})

		expect(patches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 2, mark: "X"}},
			{op: "replace", path: ["items", 2], value: {id: 3, mark: "a"}}
		])
		expect(inversePatches).toEqual([
			{op: "replace", path: ["items", 0], value: {id: 3, mark: "a"}},
			{op: "replace", path: ["items", 2], value: {id: 2, mark: "c"}}
		])
		expect(JSON.stringify(state)).toBe(baseSnapshot)

		expect(
			produce(state, draft => applyPatches(draft, inversePatches))
		).toEqual(JSON.parse(baseSnapshot))
		expect(produce(state, draft => applyPatches(draft, patches))).toEqual(
			nextState
		)
	})
})

describe("array reorder regression - related invariants", () => {
	it("shifting methods (splice/unshift) also draft relocated base elements", () => {
		const state = {
			items: [
				{id: 0, mark: "a"},
				{id: 1, mark: "b"},
				{id: 2, mark: "c"}
			]
		}
		const baseSnapshot = JSON.stringify(state)

		const nextSplice = produce(state, draft => {
			draft.items.splice(0, 1)
			draft.items[0].mark = "X"
		})
		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextSplice.items).toEqual([
			{id: 1, mark: "X"},
			{id: 2, mark: "c"}
		])

		const nextUnshift = produce(JSON.parse(baseSnapshot), draft => {
			draft.items.unshift({id: 9, mark: "z"})
			draft.items[1].mark = "Y"
		})
		expect(nextUnshift.items).toEqual([
			{id: 9, mark: "z"},
			{id: 0, mark: "Y"},
			{id: 1, mark: "b"},
			{id: 2, mark: "c"}
		])
	})

	it("works identically with autoFreeze disabled", () => {
		const {produce: produceNoFreeze} = createNoFreezeImmer()
		const state = createState()
		const baseSnapshot = JSON.stringify(state)

		const nextState = produceNoFreeze(state, draft => {
			draft.items.reverse()
			draft.items[0].mark = "X"
		})
		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextState.items).toEqual([
			{id: 2, mark: "X"},
			{id: 1, mark: "b"},
			{id: 3, mark: "a"}
		])
	})

	it("throws from the comparator without corrupting the draft", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)

		const nextState = produce(state, draft => {
			expect(() => {
				draft.items.sort(() => {
					throw new Error("boom")
				})
			}).toThrow("boom")
			// The draft is still usable after the failed sort.
			draft.items[0].mark = "X"
		})

		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextState.items[0]).toEqual({id: 3, mark: "X"})
	})

	it("returns the same draft for repeated reads of a relocated element", () => {
		const state = createState()
		produce(state, draft => {
			draft.items.sort((a, b) => a.id - b.id)
			const first = draft.items[0]
			const again = draft.items[0]
			const found = draft.items.find(item => item.id === 1)
			expect(first).toBe(again)
			expect(first).toBe(found)
			first.mark = "X"
			expect(draft.items[0].mark).toBe("X")
		})
	})

	it("drafts nested reordered arrays and produces valid patches", () => {
		const state = {
			list: [
				{id: 2, kids: [{n: 5}, {n: 1}]},
				{id: 1, kids: [{n: 3}]}
			]
		}
		const baseSnapshot = JSON.stringify(state)
		let patches, inversePatches

		const nextState = produce(
			state,
			draft => {
				draft.list.sort((a, b) => a.id - b.id)
				draft.list[0].kids.sort((x, y) => x.n - y.n)
				draft.list[0].kids[0].n = 99
			},
			(p, ip) => {
				patches = p
				inversePatches = ip
			}
		)

		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextState.list).toEqual([
			{id: 1, kids: [{n: 99}]},
			{id: 2, kids: [{n: 5}, {n: 1}]}
		])
		expect(
			produce(state, draft => applyPatches(draft, inversePatches))
		).toEqual(JSON.parse(baseSnapshot))
		expect(produce(state, draft => applyPatches(draft, patches))).toEqual(
			nextState
		)
	})

	it("mutations via a proxy obtained before the reorder still land on the draft", () => {
		const state = createState()
		const baseSnapshot = JSON.stringify(state)

		const nextState = produce(state, draft => {
			const first = draft.items[0] // proxy of {id: 3}, initially at slot 0
			draft.items.sort((a, b) => a.id - b.id) // {id: 3} moves to slot 2
			first.mark = "Z"
		})

		expect(JSON.stringify(state)).toBe(baseSnapshot)
		expect(nextState.items[2]).toEqual({id: 3, mark: "Z"})
	})
})

function createNoFreezeImmer() {
	// Local Immer instance with auto freezing turned off.
	const immer = new Immer({autoFreeze: false})
	return {produce: immer.produce}
}
