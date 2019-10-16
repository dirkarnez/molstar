/**
 * Copyright (c) 2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { PluginStateObject as SO, PluginStateTransform } from '../../../state/objects';
import { VolumeServerInfo, VolumeServerHeader } from './model';
import { ParamDefinition as PD } from '../../../../mol-util/param-definition';
import { Task } from '../../../../mol-task';
import { PluginContext } from '../../../../mol-plugin/context';
import { urlCombine } from '../../../../mol-util/url';
import { createIsoValueParam } from '../../../../mol-repr/volume/isosurface';
import { VolumeIsoValue } from '../../../../mol-model/volume';
import { StateAction, StateObject, StateTransformer } from '../../../../mol-state';
import { getStreamingMethod, getIds, getContourLevel, getEmdbIds } from './util';
import { VolumeStreaming } from './behavior';
import { VolumeRepresentation3DHelpers } from '../../../../mol-plugin/state/transforms/representation';
import { BuiltInVolumeRepresentations } from '../../../../mol-repr/volume/registry';
import { createTheme } from '../../../../mol-theme/theme';
import { Box3D } from '../../../../mol-math/geometry';
import { Vec3 } from '../../../../mol-math/linear-algebra';

function addEntry(entries: InfoEntryProps[], method: VolumeServerInfo.Kind, dataId: string, emDefaultContourLevel: number) {
    entries.push({
        source: method === 'em'
            ? { name: 'em', params: { isoValue: VolumeIsoValue.absolute(emDefaultContourLevel || 0) } }
            : { name: 'x-ray', params: { } },
        dataId
    })
}

export const InitVolumeStreaming = StateAction.build({
    display: { name: 'Volume Streaming' },
    from: SO.Molecule.Structure,
    params(a) {
        const method = getStreamingMethod(a && a.data);
        const ids = getIds(method, a && a.data);
        return {
            method: PD.Select<VolumeServerInfo.Kind>(method, [['em', 'EM'], ['x-ray', 'X-Ray']]),
            entries: PD.ObjectList({ id: PD.Text(ids[0] || '') }, ({ id }) => id, { defaultValue: ids.map(id => ({ id })) }),
            serverUrl: PD.Text('https://ds.litemol.org'),
            defaultView: PD.Select<VolumeStreaming.ViewTypes>(method === 'em' ? 'cell' : 'selection-box', VolumeStreaming.ViewTypeOptions as any),
            behaviorRef: PD.Text('', { isHidden: true }),
            emContourProvider: PD.Select<'wwpdb' | 'pdbe'>('wwpdb', [['wwpdb', 'wwPDB'], ['pdbe', 'PDBe']], { isHidden: true }),
            bindings: PD.Value(VolumeStreaming.DefaultBindings, { isHidden: true }),
        };
    },
    isApplicable: (a) => a.data.models.length === 1
})(({ ref, state, params }, plugin: PluginContext) => Task.create('Volume Streaming', async taskCtx => {
    const entries: InfoEntryProps[] = []

    for (let i = 0, il = params.entries.length; i < il; ++i) {
        let dataId = params.entries[i].id.toLowerCase()
        let emDefaultContourLevel: number | undefined;

        if (params.method === 'em') {
            // if pdb ids are given for method 'em', get corresponding emd ids
            // and continue the loop
            if (!dataId.toUpperCase().startsWith('EMD')) {
                await taskCtx.update('Getting EMDB info...');
                const emdbIds = await getEmdbIds(plugin, taskCtx, dataId)
                for (let j = 0, jl = emdbIds.length; j < jl; ++j) {
                    const emdbId = emdbIds[j]
                    const contourLevel = await getContourLevel(params.emContourProvider, plugin, taskCtx, emdbId)
                    addEntry(entries, params.method, emdbId, contourLevel || 0)
                }
                continue;
            }
            emDefaultContourLevel = await getContourLevel(params.emContourProvider, plugin, taskCtx, dataId);
        }

        addEntry(entries, params.method, dataId, emDefaultContourLevel || 0)
    }

    const infoTree = state.build().to(ref)
        .apply(CreateVolumeStreamingInfo, {
            serverUrl: params.serverUrl,
            entries
        });

    const infoObj = await state.updateTree(infoTree).runInContext(taskCtx);

    const behTree = state.build().to(infoTree.ref).apply(CreateVolumeStreamingBehavior,
        PD.getDefaultValues(VolumeStreaming.createParams(infoObj.data, params.defaultView, params.bindings)),
        { ref: params.behaviorRef ? params.behaviorRef : void 0 });

    if (params.method === 'em') {
        behTree.apply(VolumeStreamingVisual, { channel: 'em' }, { state: { isGhost: true } });
    } else {
        behTree.apply(VolumeStreamingVisual, { channel: '2fo-fc' }, { state: { isGhost: true } });
        behTree.apply(VolumeStreamingVisual, { channel: 'fo-fc(+ve)' }, { state: { isGhost: true } });
        behTree.apply(VolumeStreamingVisual, { channel: 'fo-fc(-ve)' }, { state: { isGhost: true } });
    }
    await state.updateTree(behTree).runInContext(taskCtx);
}));

export const BoxifyVolumeStreaming = StateAction.build({
    display: { name: 'Boxify Volume Streaming', description: 'Make the current box permanent.' },
    from: VolumeStreaming,
    isApplicable: (a) => a.data.params.entry.params.view.name === 'selection-box'
})(({ a, ref, state }, plugin: PluginContext) => {
    const params = a.data.params;
    if (params.entry.params.view.name !== 'selection-box') return;
    const box = Box3D.create(Vec3.clone(params.entry.params.view.params.bottomLeft), Vec3.clone(params.entry.params.view.params.topRight));
    const r = params.entry.params.view.params.radius;
    Box3D.expand(box, box, Vec3.create(r, r, r));
    const newParams: VolumeStreaming.Params = {
        ...params,
        entry: {
            name: params.entry.name,
            params: {
                ...params.entry.params,
                view: {
                    name: 'box' as 'box',
                    params: {
                        bottomLeft: box.min,
                        topRight: box.max
                    }
                }
            }
        }
    };
    return state.updateTree(state.build().to(ref).update(newParams));
});

const InfoEntryParams = {
    dataId: PD.Text(''),
    source: PD.MappedStatic('x-ray', {
        'em': PD.Group({
            isoValue: createIsoValueParam(VolumeIsoValue.relative(1))
        }),
        'x-ray': PD.Group({ })
    })
}
type InfoEntryProps = PD.Values<typeof InfoEntryParams>

export { CreateVolumeStreamingInfo }
type CreateVolumeStreamingInfo = typeof CreateVolumeStreamingInfo
const CreateVolumeStreamingInfo = PluginStateTransform.BuiltIn({
    name: 'create-volume-streaming-info',
    display: { name: 'Volume Streaming Info' },
    from: SO.Molecule.Structure,
    to: VolumeServerInfo,
    params(a) {
        return {
            serverUrl: PD.Text('https://ds.litemol.org'),
            entries: PD.ObjectList<InfoEntryProps>(InfoEntryParams, ({ dataId }) => dataId, {
                defaultValue: [{ dataId: '', source: { name: 'x-ray', params: {} } }]
            }),
        };
    }
})({
    apply: ({ a, params }, plugin: PluginContext) => Task.create('', async taskCtx => {
        const entries: VolumeServerInfo.EntryData[] = []
        for (let i = 0, il = params.entries.length; i < il; ++i) {
            const e = params.entries[i]
            const dataId = e.dataId;
            const emDefaultContourLevel = e.source.name === 'em' ? e.source.params.isoValue : VolumeIsoValue.relative(1);
            await taskCtx.update('Getting server header...');
            const header = await plugin.fetch<VolumeServerHeader>({ url: urlCombine(params.serverUrl, `${e.source.name}/${dataId.toLocaleLowerCase()}`), type: 'json' }).runInContext(taskCtx);
            entries.push({
                dataId,
                kind: e.source.name,
                header,
                emDefaultContourLevel
            })
        }

        const data: VolumeServerInfo.Data = {
            serverUrl: params.serverUrl,
            entries,
            structure: a.data
        };
        return new VolumeServerInfo(data, { label: 'Volume Server', description: `${entries.map(e => e.dataId). join(', ')}` });
    })
});

export { CreateVolumeStreamingBehavior }
type CreateVolumeStreamingBehavior = typeof CreateVolumeStreamingBehavior
const CreateVolumeStreamingBehavior = PluginStateTransform.BuiltIn({
    name: 'create-volume-streaming-behavior',
    display: { name: 'Volume Streaming Behavior' },
    from: VolumeServerInfo,
    to: VolumeStreaming,
    params(a) {
        return VolumeStreaming.createParams(a && a.data);
    }
})({
    canAutoUpdate: ({ oldParams, newParams }) => {
        return oldParams.entry.params.view === newParams.entry.params.view
            || newParams.entry.params.view.name === 'selection-box'
            || newParams.entry.params.view.name === 'off';
    },
    apply: ({ a, params }, plugin: PluginContext) => Task.create('Volume streaming', async _ => {
        const behavior = new VolumeStreaming.Behavior(plugin, a.data);
        await behavior.update(params);
        return new VolumeStreaming(behavior, { label: 'Volume Streaming', description: behavior.getDescription() });
    }),
    update({ a, b, oldParams, newParams }) {
        return Task.create('Update Volume Streaming', async _ => {
            if (oldParams.entry.name !== newParams.entry.name) {
                if ('em' in newParams.entry.params.channels) {
                    const { emDefaultContourLevel } = b.data.infoMap.get(newParams.entry.name)!
                    if (emDefaultContourLevel) {
                        newParams.entry.params.channels['em'].isoValue = emDefaultContourLevel
                    }
                }
            }
            const ret = await b.data.update(newParams) ? StateTransformer.UpdateResult.Updated : StateTransformer.UpdateResult.Unchanged;
            b.description = b.data.getDescription();
            return ret;
        });
    }
});

export { VolumeStreamingVisual }
type VolumeStreamingVisual = typeof VolumeStreamingVisual
const VolumeStreamingVisual = PluginStateTransform.BuiltIn({
    name: 'create-volume-streaming-visual',
    display: { name: 'Volume Streaming Visual' },
    from: VolumeStreaming,
    to: SO.Volume.Representation3D,
    params: {
        channel: PD.Select<VolumeStreaming.ChannelType>('em', VolumeStreaming.ChannelTypeOptions, { isHidden: true })
    }
})({
    apply: ({ a, params: srcParams }, plugin: PluginContext) => Task.create('Volume Representation', async ctx => {
        const channel = a.data.channels[srcParams.channel];
        if (!channel) return StateObject.Null;

        const params = createVolumeProps(a.data, srcParams.channel);

        const provider = BuiltInVolumeRepresentations.isosurface;
        const props = params.type.params || {}
        const repr = provider.factory({ webgl: plugin.canvas3d.webgl, ...plugin.volumeRepresentation.themeCtx }, provider.getParams)
        repr.setTheme(createTheme(plugin.volumeRepresentation.themeCtx, { volume: channel.data }, params))
        await repr.createOrUpdate(props, channel.data).runInContext(ctx);
        return new SO.Volume.Representation3D({ repr, source: a }, { label: `${Math.round(channel.isoValue.relativeValue * 100) / 100} σ [${srcParams.channel}]` });
    }),
    update: ({ a, b, oldParams, newParams }, plugin: PluginContext) => Task.create('Volume Representation', async ctx => {
        // TODO : check if params/underlying data/etc have changed; maybe will need to export "data" or some other "tag" in the Representation for this to work

        const channel = a.data.channels[newParams.channel];
        // TODO: is this correct behavior?
        if (!channel) return StateTransformer.UpdateResult.Unchanged;

        const params = createVolumeProps(a.data, newParams.channel);
        const props = { ...b.data.repr.props, ...params.type.params };
        b.data.repr.setTheme(createTheme(plugin.volumeRepresentation.themeCtx, { volume: channel.data }, params))
        await b.data.repr.createOrUpdate(props, channel.data).runInContext(ctx);
        return StateTransformer.UpdateResult.Updated;
    })
});

function createVolumeProps(streaming: VolumeStreaming.Behavior, channelName: VolumeStreaming.ChannelType) {
    const channel = streaming.channels[channelName]!;
    return VolumeRepresentation3DHelpers.getDefaultParamsStatic(streaming.plugin,
        'isosurface', { isoValue: channel.isoValue, alpha: channel.opacity, visuals: channel.wireframe ? ['wireframe'] : ['solid'] },
        'uniform', { value: channel.color });
}