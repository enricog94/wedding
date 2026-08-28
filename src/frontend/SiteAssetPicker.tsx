import { SiteAssetLibrary } from './SiteAssetLibrary';
import type { SiteAsset, SiteAssetType } from './siteAssets';

type SiteAssetPickerProps = {
  assetType: SiteAssetType;
  selectedId: number | null;
  onSelect: (asset: SiteAsset) => void;
  onClose: () => void;
};

export function SiteAssetPicker({ assetType, selectedId, onSelect, onClose }: SiteAssetPickerProps) {
  return (
    <div className="approved-media-picker" role="dialog" aria-modal="true" aria-labelledby="site-asset-picker-title">
      <div className="approved-media-picker__panel">
        <div className="approved-media-picker__heading">
          <div><p>Media editoriali</p><h3 id="site-asset-picker-title">Scegli o carica una foto</h3></div>
          <button type="button" onClick={onClose} aria-label="Chiudi selezione foto">Chiudi</button>
        </div>
        <SiteAssetLibrary
          filter={assetType}
          initialUploadType={assetType}
          selectedId={selectedId}
          onSelect={onSelect}
          allowDelete={false}
        />
      </div>
    </div>
  );
}
