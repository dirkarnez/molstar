/**
 * Copyright (c) 2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Structure, Unit } from '../../../mol-model/structure';
import { StructureElement } from '../../../mol-model/structure/structure';
import { Elements } from '../../../mol-model/structure/model/properties/atomic/types';

export function typeSymbol(unit: Unit.Atomic, index: StructureElement.UnitIndex) {
    return unit.model.atomicHierarchy.atoms.type_symbol.value(unit.elements[index])
}

export function formalCharge(unit: Unit.Atomic, index: StructureElement.UnitIndex) {
    return unit.model.atomicHierarchy.atoms.pdbx_formal_charge.value(unit.elements[index])
}

export function atomId(unit: Unit.Atomic, index: StructureElement.UnitIndex) {
    return unit.model.atomicHierarchy.atoms.label_atom_id.value(unit.elements[index])
}

export function altLoc(unit: Unit.Atomic, index: StructureElement.UnitIndex) {
    return unit.model.atomicHierarchy.atoms.label_alt_id.value(unit.elements[index])
}

export function compId(unit: Unit.Atomic, index: StructureElement.UnitIndex) {
    return unit.model.atomicHierarchy.residues.label_comp_id.value(unit.elements[index])
}

//

export function interBondCount(structure: Structure, unit: Unit.Atomic, index: StructureElement.UnitIndex): number {
    return structure.interUnitBonds.getEdgeIndices(index, unit).length
}

export function intraBondCount(unit: Unit.Atomic, index: StructureElement.UnitIndex): number {
    const { offset } = unit.bonds
    return offset[index + 1] - offset[index]
}

export function bondCount(structure: Structure, unit: Unit.Atomic, index: StructureElement.UnitIndex): number {
    return interBondCount(structure, unit, index) + intraBondCount(unit, index)
}

export function bondToElementCount(structure: Structure, unit: Unit.Atomic, index: StructureElement.UnitIndex, element: Elements): number {
    let count = 0
    eachBondedAtom(structure, unit, index, (unit: Unit.Atomic, index: StructureElement.UnitIndex) => {
        if (typeSymbol(unit, index) === element) count += 1
    })
    return count
}

//

export function intraConnectedTo(unit: Unit.Atomic, indexA: StructureElement.UnitIndex, indexB: StructureElement.UnitIndex) {
    const { offset, b } = unit.bonds
    for (let i = offset[indexA], il = offset[indexA + 1]; i < il; ++i) {
        if (b[i] === indexB) return true
    }
    return false
}

//

export function eachInterBondedAtom(structure: Structure, unit: Unit.Atomic, index: StructureElement.UnitIndex, cb: (unit: Unit.Atomic, index: StructureElement.UnitIndex) => void): void {
    // inter
    const interIndices = structure.interUnitBonds.getEdgeIndices(index, unit)
    for (let i = 0, il = interIndices.length; i < il; ++i) {
        const b = structure.interUnitBonds.edges[i]
        cb(b.unitB, b.indexB)
    }
}

export function eachIntraBondedAtom(unit: Unit.Atomic, index: StructureElement.UnitIndex, cb: (unit: Unit.Atomic, index: StructureElement.UnitIndex) => void): void {
    // intra
    const { offset, b } = unit.bonds
    for (let i = offset[index], il = offset[index + 1]; i < il; ++i) {
        cb(unit, b[i] as StructureElement.UnitIndex)
    }
}

export function eachBondedAtom(structure: Structure, unit: Unit.Atomic, index: StructureElement.UnitIndex, cb: (unit: Unit.Atomic, index: StructureElement.UnitIndex) => void): void {
    eachInterBondedAtom(structure, unit, index, cb)
    eachIntraBondedAtom(unit, index, cb)
}