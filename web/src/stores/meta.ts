import { defineStore } from 'pinia';
import { api } from '../api';

/** 下拉选项缓存（课程类别/基础水平/报名来源/请假退费类型/教室/教师/期次） */
export const useMetaStore = defineStore('meta', {
  state: () => ({
    loaded: false,
    categories: [] as string[],
    levels: [] as string[],
    sources: [] as string[],
    leaveReasonTypes: [] as string[],
    refundReasonTypes: [] as string[],
    courseStatuses: [] as string[],
    eventTypes: [] as string[],
    rooms: [] as any[],
    teachers: [] as any[],
    terms: [] as string[],
  }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      const { data } = await api.get('/meta/options');
      Object.assign(this, data);
      this.loaded = true;
    },
  },
});
