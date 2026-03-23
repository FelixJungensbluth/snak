import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import * as api from "../api/workspace";
import type { Skill } from "../api/workspace";

interface SkillState {
  skills: Skill[];
  loaded: boolean;
}

interface SkillActions {
  loadSkills: () => Promise<void>;
  saveSkill: (name: string, content: string) => Promise<void>;
  deleteSkill: (name: string) => Promise<void>;
}

export const useSkillStore = create<SkillState & SkillActions>()(
  immer((set) => ({
    skills: [],
    loaded: false,

    loadSkills: async () => {
      try {
        await api.ensureDefaultSkills();
        const skills = await api.listSkills();
        set((state) => {
          state.skills = skills;
          state.loaded = true;
        });
      } catch (e) {
        console.error("Failed to load skills:", e);
      }
    },

    saveSkill: async (name, content) => {
      try {
        await api.saveSkill(name, content);
        const skills = await api.listSkills();
        set((state) => {
          state.skills = skills;
        });
      } catch (e) {
        console.error("Failed to save skill:", e);
      }
    },

    deleteSkill: async (name) => {
      try {
        await api.deleteSkill(name);
        set((state) => {
          state.skills = state.skills.filter((s) => s.name !== name);
        });
      } catch (e) {
        console.error("Failed to delete skill:", e);
      }
    },
  })),
);
