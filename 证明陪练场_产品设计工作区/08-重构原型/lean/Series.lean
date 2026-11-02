import Mathlib
open Filter Topology

example : (∃ l : ℝ, Tendsto (fun n => ∑ i ∈ Finset.range n, (-1 : ℝ) ^ i * (1 / Real.sqrt (i + 1))) atTop (𝓝 l))
    ∧ ¬ Summable (fun i : ℕ => 1 / Real.sqrt (i + 1)) := by
  constructor
  · have hanti : Antitone (fun i : ℕ => 1 / Real.sqrt (i + 1)) := by
      intro a b hab
      have : (a : ℝ) + 1 ≤ b + 1 := by exact_mod_cast Nat.succ_le_succ hab
      exact one_div_le_one_div_of_le (Real.sqrt_pos.mpr (by positivity)) (Real.sqrt_le_sqrt this)
    have h0 : Tendsto (fun i : ℕ => 1 / Real.sqrt (i + 1)) atTop (𝓝 0) := by
      have h1 : Tendsto (fun i : ℕ => ((i : ℝ) + 1)) atTop atTop :=
        tendsto_atTop_add_const_right _ 1 tendsto_natCast_atTop_atTop
      exact tendsto_const_nhds.div_atTop (Real.tendsto_sqrt_atTop.comp h1)
    exact hanti.tendsto_alternating_series_of_tendsto_zero h0
  · intro h
    have h2 : Summable (fun n : ℕ => 1 / (n : ℝ) ^ (1 / 2 : ℝ)) := by
      rw [← summable_nat_add_iff 1]
      simpa [Real.sqrt_eq_rpow, Nat.cast_add, Nat.cast_one] using h
    have := (Real.summable_one_div_nat_rpow (p := 1 / 2)).mp h2
    norm_num at this
