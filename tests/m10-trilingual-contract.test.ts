import { describe, expect, it } from "vitest";
import { locales, t } from "../apps/web/src/i18n";
import { wmsMenuGroups, wmsTabTranslationKeys } from "../apps/web/src/wms";

describe("M10 trilingual management contract",()=>{
  it("has Chinese, Vietnamese and English text for every canonical WMS navigation item",()=>{
    const keys=new Set<string>();
    for(const group of wmsMenuGroups){
      keys.add(group.translationKey);
      for(const tab of group.tabs) keys.add(wmsTabTranslationKeys[tab]);
    }
    for(const key of keys){
      for(const locale of locales){
        const translated=t(key,locale);
        expect(translated,`${key} missing ${locale}`).not.toBe(key);
        expect(translated.trim(),`${key} empty ${locale}`).not.toBe("");
      }
    }
  });

  it("has localized loading, empty/error recovery labels and synchronization navigation",()=>{
    for(const key of ["common.refresh","common.loading","common.loadError","wms.subnav.syncHealth"]){
      for(const locale of locales) expect(t(key,locale),`${key} missing ${locale}`).not.toBe(key);
    }
  });
});
