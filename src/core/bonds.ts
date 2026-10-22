import type { Bond } from './types.ts';

export const BOND_TIERS = [
  { min: 0, max: 19, label: '陌生' },
  { min: 20, max: 39, label: '熟悉' },
  { min: 40, max: 59, label: '亲近' },
  { min: 60, max: 79, label: '信任' },
  { min: 80, max: 100, label: '挚交' },
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bondScore(bond: Bond): number {
  const total = bond.events.reduce((sum, event) => sum + (Number(event.delta) || 0), 0);
  return clamp(Math.round(bond.initialScore + bond.manualDelta + total), 0, 100);
}

export function bondTier(score: number): { min: number; max: number; label: string } {
  return BOND_TIERS.find((tier) => score >= tier.min && score <= tier.max) ?? BOND_TIERS[0];
}
