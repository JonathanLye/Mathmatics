import Mathlib
open Filter Topology

example : Tendsto (fun n : ℕ => ((3 * n + 1 : ℝ) / (n + 2))) atTop (𝓝 3) := by
  rw [Metric.tendsto_atTop]
  intro ε hε
  obtain ⟨N, hN⟩ := exists_nat_gt (5 / ε)
  refine ⟨N, fun n hn => ?_⟩
  have hn' : (N : ℝ) ≤ n := by exact_mod_cast hn
  have hpos : (0 : ℝ) < n + 2 := by positivity
  have h5 : 5 < ε * N := by rwa [div_lt_iff₀ hε, mul_comm] at hN
  have e : ((3 * n + 1 : ℝ) / (n + 2)) - 3 = -5 / (n + 2) := by field_simp; ring
  rw [Real.dist_eq, e, abs_div, abs_of_pos hpos, div_lt_iff₀ hpos]
  norm_num
  nlinarith
