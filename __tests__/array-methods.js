"use strict"
import {
	Immer,
	produce,
	produceWithPatches,
	applyPatches,
	createDraft,
	finishDraft,
	enablePatches,
	enableMapSet,
	enableArrayMethods,
	isDraft
} from "../src/immer"
import deepFreeze from "deep-freeze"

enablePatches()
enableMapSet()
enableArrayMethods()

function createState() {
	return {
		items: [{v: 3}, {v: 1}, {v: 2}]
	}
}

const byValue = (a, b) => a.v - b.v

for (const autoFreeze of [true, false]) {
	describe(`array methods (autoFreeze=${autoFreeze})`, () => {
		const immer = new Immer({autoFreeze})

		function produceWithTracking(base, recipe) {
			const itemsRef = base.items
			const snapshot = JSON.stringify(base.items)
			const [next, patches, inversePatches] = immer.produceWithPatches(
				base,
				recipe
			)
			return {itemsRef, snapshot, next, patches, inversePatches}
		}

		function expectBaseIntact(base, itemsRef, snapshot) {
			// The original array must be untouched: same reference, same order,
			// same (unmutated) elements
			expect(base.items).toBe(itemsRef)
			expect(JSON.stringify(base.items)).toBe(snapshot)
		}

		it("sort only reorders the draft, never the original array", () => {
			const base = createState()
			const {itemsRef, snapshot, next} = produceWithTracking(base, draft => {
				draft.items.sort(byValue)
			})

			expectBaseIntact(base, itemsRef, snapshot)
			expect(next).not.toBe(base)
			expect(next.items).not.toBe(itemsRef)
			expect(next.items.map(x => x.v)).toEqual([1, 2, 3])
			// structural sharing: elements themselves were not modified
			expect(next.items[0]).toBe(itemsRef[1])
			expect(next.items[1]).toBe(itemsRef[2])
			expect(next.items[2]).toBe(itemsRef[0])
		})

		it("reverse only reorders the draft, never the original array", () => {
			const base = createState()
			const {itemsRef, snapshot, next} = produceWithTracking(base, draft => {
				draft.items.reverse()
			})

			expectBaseIntact(base, itemsRef, snapshot)
			expect(next.items.map(x => x.v)).toEqual([2, 1, 3])
			expect(next.items[0]).toBe(itemsRef[2])
			expect(next.items[2]).toBe(itemsRef[0])
		})

		it("sort + modifying a moved element does not leak into the original state", () => {
			const base = createState()
			const {itemsRef, snapshot, next, patches, inversePatches} =
				produceWithTracking(base, draft => {
					draft.items.sort(byValue)
					draft.items[0].v = 99
				})

			expectBaseIntact(base, itemsRef, snapshot)
			expect(next.items.map(x => x.v)).toEqual([99, 2, 3])
			// the modified element is a new object, the others are shared
			expect(next.items[0]).not.toBe(itemsRef[1])
			expect(next.items[1]).toBe(itemsRef[2])
			expect(next.items[2]).toBe(itemsRef[0])

			expect(patches).toEqual([
				{op: "replace", path: ["items", 0], value: {v: 99}},
				{op: "replace", path: ["items", 1], value: {v: 2}},
				{op: "replace", path: ["items", 2], value: {v: 3}}
			])
			expect(inversePatches).toEqual([
				{op: "replace", path: ["items", 0], value: {v: 3}},
				{op: "replace", path: ["items", 1], value: {v: 1}},
				{op: "replace", path: ["items", 2], value: {v: 2}}
			])

			// patches and inverse patches must round-trip
			expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([
				99, 2, 3
			])
			expect(applyPatches(next, inversePatches).items.map(x => x.v)).toEqual([
				3, 1, 2
			])
		})

		it("reverse + modifying a moved element does not leak into the original state", () => {
			const base = createState()
			const {itemsRef, snapshot, next, patches, inversePatches} =
				produceWithTracking(base, draft => {
					draft.items.reverse()
					draft.items[0].v = 99
				})

			expectBaseIntact(base, itemsRef, snapshot)
			expect(next.items.map(x => x.v)).toEqual([99, 1, 3])

			expect(patches).toEqual([
				{op: "replace", path: ["items", 0], value: {v: 99}},
				{op: "replace", path: ["items", 2], value: {v: 3}}
			])
			expect(inversePatches).toEqual([
				{op: "replace", path: ["items", 0], value: {v: 3}},
				{op: "replace", path: ["items", 2], value: {v: 2}}
			])

			expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([
				99, 1, 3
			])
			expect(applyPatches(next, inversePatches).items.map(x => x.v)).toEqual([
				3, 1, 2
			])
		})

		it("works when the array lives deeper in the state tree", () => {
			const base = {nested: {items: [{v: 3}, {v: 1}, {v: 2}]}}
			const itemsRef = base.nested.items
			const snapshot = JSON.stringify(itemsRef)

			const [next, patches, inversePatches] = immer.produceWithPatches(
				base,
				draft => {
					draft.nested.items.sort(byValue)
					draft.nested.items[0].v = 99
				}
			)

			expect(base.nested.items).toBe(itemsRef)
			expect(JSON.stringify(base.nested.items)).toBe(snapshot)
			expect(next.nested.items.map(x => x.v)).toEqual([99, 2, 3])
			expect(next.nested).not.toBe(base.nested)

			expect(applyPatches(base, patches).nested.items.map(x => x.v)).toEqual([
				99, 2, 3
			])
			expect(
				applyPatches(next, inversePatches).nested.items.map(x => x.v)
			).toEqual([3, 1, 2])
		})

		it("works with nested arrays", () => {
			const base = {matrix: [[{v: 3}], [{v: 1}], [{v: 2}]]}
			const matrixRef = base.matrix
			const snapshot = JSON.stringify(matrixRef)

			const [next, patches, inversePatches] = immer.produceWithPatches(
				base,
				draft => {
					draft.matrix.sort((a, b) => a[0].v - b[0].v)
					draft.matrix[0][0].v = 99
				}
			)

			expect(base.matrix).toBe(matrixRef)
			expect(JSON.stringify(base.matrix)).toBe(snapshot)
			expect(next.matrix.map(row => row[0].v)).toEqual([99, 2, 3])

			expect(applyPatches(base, patches).matrix.map(row => row[0].v)).toEqual([
				99, 2, 3
			])
			expect(
				applyPatches(next, inversePatches).matrix.map(row => row[0].v)
			).toEqual([3, 1, 2])
		})

		it("reading the same moved element twice yields the same draft", () => {
			const base = createState()
			const next = immer.produce(base, draft => {
				draft.items.sort(byValue)
				const first = draft.items[0]
				const second = draft.items[0]
				expect(isDraft(first)).toBe(true)
				expect(first).toBe(second)
				first.v = 99
				expect(draft.items[0].v).toBe(99)
			})
			expect(next.items.map(x => x.v)).toEqual([99, 2, 3])
			expect(base.items.map(x => x.v)).toEqual([3, 1, 2])
		})

		it("a throwing comparator leaves the original state untouched", () => {
			const base = createState()
			const itemsRef = base.items
			const snapshot = JSON.stringify(itemsRef)

			expect(() =>
				immer.produce(base, draft => {
					draft.items.sort(() => {
						throw new Error("boom")
					})
				})
			).toThrow("boom")

			expect(base.items).toBe(itemsRef)
			expect(JSON.stringify(base.items)).toBe(snapshot)
		})

		it("supports the recipe returning a new value after reading a sorted draft", () => {
			const base = createState()
			const itemsRef = base.items
			const snapshot = JSON.stringify(itemsRef)

			const [next, patches, inversePatches] = immer.produceWithPatches(
				base,
				draft => {
					const sorted = draft.items.map(x => x.v)
					sorted.sort((a, b) => a - b)
					return {items: sorted}
				}
			)

			expect(base.items).toBe(itemsRef)
			expect(JSON.stringify(base.items)).toBe(snapshot)
			expect(next).toEqual({items: [1, 2, 3]})
			expect(patches).toEqual([
				{op: "replace", path: [], value: {items: [1, 2, 3]}}
			])
			expect(applyPatches(next, inversePatches)).toEqual(base)
		})

		it("supports the recipe returning the draft itself after sorting", () => {
			const base = createState()
			const itemsRef = base.items
			const snapshot = JSON.stringify(itemsRef)

			const next = immer.produce(base, draft => {
				draft.items.sort(byValue)
				return draft
			})

			expect(JSON.stringify(base.items)).toBe(snapshot)
			expect(next.items.map(x => x.v)).toEqual([1, 2, 3])
		})

		it("length semantics are preserved by reordering operations", () => {
			const base = createState()
			const [next, patches] = immer.produceWithPatches(base, draft => {
				draft.items.sort(byValue)
				expect(draft.items.length).toBe(3)
				draft.items.push({v: 0})
				expect(draft.items.length).toBe(4)
				draft.items.reverse()
				expect(draft.items.length).toBe(4)
			})
			expect(next.items.map(x => x.v)).toEqual([0, 3, 2, 1])
			expect(base.items.map(x => x.v)).toEqual([3, 1, 2])
			expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([
				0, 3, 2, 1
			])
		})

		it("shifted elements after splice can be modified safely", () => {
			const base = createState()
			const {itemsRef, snapshot, next, patches, inversePatches} =
				produceWithTracking(base, draft => {
					draft.items.splice(0, 1)
					draft.items[0].v = 99
				})

			expectBaseIntact(base, itemsRef, snapshot)
			expect(next.items.map(x => x.v)).toEqual([99, 2])
			expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([99, 2])
			expect(applyPatches(next, inversePatches).items.map(x => x.v)).toEqual([
				3, 1, 2
			])
		})

		it("shifted elements after shift can be modified safely", () => {
			const base = createState()
			const {itemsRef, snapshot, next} = produceWithTracking(base, draft => {
				draft.items.shift()
				draft.items[0].v = 99
			})

			expectBaseIntact(base, itemsRef, snapshot)
			expect(next.items.map(x => x.v)).toEqual([99, 2])
		})

		it("values assigned after a reorder are not drafted", () => {
			const base = createState()
			const fresh = {v: 0}
			const next = immer.produce(base, draft => {
				draft.items.sort(byValue)
				draft.items[0] = fresh
				// assigned values keep their identity (are not drafted)
				expect(draft.items[0]).toBe(fresh)
			})
			expect(next.items[0]).toBe(fresh)
			expect(base.items.map(x => x.v)).toEqual([3, 1, 2])
		})

		it("does not disturb Maps and Sets in the same state", () => {
			const base = {
				items: [{v: 3}, {v: 1}, {v: 2}],
				lookup: new Map([["a", 1]]),
				tags: new Set(["x"])
			}
			const snapshot = JSON.stringify(base.items)

			const next = immer.produce(base, draft => {
				draft.items.sort(byValue)
				draft.items[0].v = 99
				draft.lookup.set("b", 2)
				draft.tags.add("y")
			})

			expect(JSON.stringify(base.items)).toBe(snapshot)
			expect(base.lookup.has("b")).toBe(false)
			expect(base.tags.has("y")).toBe(false)
			expect(next.items.map(x => x.v)).toEqual([99, 2, 3])
			expect(next.lookup.get("b")).toBe(2)
			expect(next.tags.has("y")).toBe(true)
		})
	})
}

describe("array methods on frozen base state", () => {
	it("sort + modify works on a deeply frozen state", () => {
		const base = deepFreeze(createState())
		const snapshot = JSON.stringify(base.items)

		const [next, patches, inversePatches] = produceWithPatches(base, draft => {
			draft.items.sort(byValue)
			draft.items[0].v = 99
		})

		expect(JSON.stringify(base.items)).toBe(snapshot)
		expect(next.items.map(x => x.v)).toEqual([99, 2, 3])
		expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([99, 2, 3])
		expect(applyPatches(next, inversePatches).items.map(x => x.v)).toEqual([
			3, 1, 2
		])
	})

	it("reverse + modify works on a deeply frozen state", () => {
		const base = deepFreeze(createState())
		const snapshot = JSON.stringify(base.items)

		const next = produce(base, draft => {
			draft.items.reverse()
			draft.items[0].v = 99
		})

		expect(JSON.stringify(base.items)).toBe(snapshot)
		expect(next.items.map(x => x.v)).toEqual([99, 1, 3])
	})
})

describe("array methods with manual drafts", () => {
	it("sort + modify via createDraft/finishDraft keeps the original intact", () => {
		const base = createState()
		const itemsRef = base.items
		const snapshot = JSON.stringify(itemsRef)

		const draft = createDraft(base)
		draft.items.sort(byValue)
		draft.items[0].v = 99

		let patches, inversePatches
		const next = finishDraft(draft, (p, ip) => {
			patches = p
			inversePatches = ip
		})

		expect(base.items).toBe(itemsRef)
		expect(JSON.stringify(base.items)).toBe(snapshot)
		expect(next.items.map(x => x.v)).toEqual([99, 2, 3])

		expect(patches).toEqual([
			{op: "replace", path: ["items", 0], value: {v: 99}},
			{op: "replace", path: ["items", 1], value: {v: 2}},
			{op: "replace", path: ["items", 2], value: {v: 3}}
		])
		expect(inversePatches).toEqual([
			{op: "replace", path: ["items", 0], value: {v: 3}},
			{op: "replace", path: ["items", 1], value: {v: 1}},
			{op: "replace", path: ["items", 2], value: {v: 2}}
		])

		expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([99, 2, 3])
		expect(applyPatches(next, inversePatches).items.map(x => x.v)).toEqual([
			3, 1, 2
		])
	})

	it("reverse + modify via createDraft/finishDraft keeps the original intact", () => {
		const base = createState()
		const itemsRef = base.items
		const snapshot = JSON.stringify(itemsRef)

		const draft = createDraft(base)
		draft.items.reverse()
		draft.items[0].v = 99

		let patches, inversePatches
		const next = finishDraft(draft, (p, ip) => {
			patches = p
			inversePatches = ip
		})

		expect(base.items).toBe(itemsRef)
		expect(JSON.stringify(base.items)).toBe(snapshot)
		expect(next.items.map(x => x.v)).toEqual([99, 1, 3])

		expect(applyPatches(base, patches).items.map(x => x.v)).toEqual([99, 1, 3])
		expect(applyPatches(next, inversePatches).items.map(x => x.v)).toEqual([
			3, 1, 2
		])
	})

	it("manual draft on the array itself", () => {
		const base = [{v: 3}, {v: 1}, {v: 2}]
		const snapshot = JSON.stringify(base)

		const draft = createDraft(base)
		draft.sort(byValue)
		draft[0].v = 99

		let patches, inversePatches
		const next = finishDraft(draft, (p, ip) => {
			patches = p
			inversePatches = ip
		})

		expect(JSON.stringify(base)).toBe(snapshot)
		expect(next.map(x => x.v)).toEqual([99, 2, 3])
		expect(applyPatches(base, patches).map(x => x.v)).toEqual([99, 2, 3])
		expect(applyPatches(next, inversePatches).map(x => x.v)).toEqual([3, 1, 2])
	})
})
