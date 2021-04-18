import React, { createContext, CSSProperties, MutableRefObject, ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import shallowequal from "shallowequal";
import { VariableSizeListProps, areEqual, ListChildComponentProps, VariableSizeList } from "react-window";

const DynamicListContext = createContext<
    Partial<{ setSize: (id: string | number, size: number) => void }>
>({});

export type RowRenderingContext<T,
 MemoState> = RowMeasurerPropsWithoutChildren<T, MemoState> & {
    ref: MutableRefObject<Element | null>;
};

export interface RowRenderer<T, MemoState> {
    (ctx: RowRenderingContext<T, MemoState>): ReactNode
}

export interface RowMeasurerProps<T, MemoState> {
    index: number;
    id: string | number;
    width: number;
    data: T[];
    style: CSSProperties;
    children: RowRenderer<T, MemoState>;
    memoState?: MemoState;
    rootProps?: object;
}

export type RowMeasurerPropsWithoutChildren<T, MemoState> = Omit<RowMeasurerProps<T, MemoState>, "children">;

export function RowMeasurer<T, MemoState>({ index, rootProps, id, width, data, style, children, memoState }: RowMeasurerProps<T, MemoState>) {
    const { setSize } = useContext(DynamicListContext);
    const rowRoot = useRef<null | HTMLDivElement>(null);

    const observer = useMemo(() => new ResizeObserver((([ entry ]: ResizeObserverEntry[]) => {
        if (setSize && entry.contentRect.height) {
            setSize(id, entry.contentRect.height);
        }
    })), []);
    
    useEffect(() => {
        if (rowRoot.current) {
            observer.disconnect();
            observer.observe(rowRoot.current);
        }

        return () => {
            observer.disconnect();
        };
    }, [id, setSize, width]);

    return (
        <div style={style} {...rootProps}>
            {children({
                ref: rowRoot,
                index,
                data,
                id,
                width,
                style,
                memoState
            })}
        </div>
    );
}

export type TypedListChildComponentProps<T = any> = Omit<ListChildComponentProps, "data"> & {
    data: T;
}

export interface DynamicSizeListProps<T, MemoState> {
    height: number;
    width: number;
    nonce?: string;
    itemData: T[];
    getID: (index: number, data: T[]) => string;
    children: RowRenderer<T, MemoState>;
    defaultSize?: number;
    overscanCount?: number;
    outerRef?: any;
    innerRef?: any;
    nearEnd?: () => void;
    isSame?: (oldProps: RowMeasurerPropsWithoutChildren<T, MemoState>, newProps: RowMeasurerPropsWithoutChildren<T, MemoState>) => boolean;
    memoState?: MemoState;
    getProps?: (index: number) => object;
}

const sizeStorage: Map<string, Record<string, number>> = new Map();

const styleCaches: Record<string, object> = {};

class PatchedVariableSizeList extends (VariableSizeList as unknown as {
    new(props: VariableSizeListProps): VariableSizeList & {
        _getItemStyle: (index: number) => object;
    }
}) {
    constructor(props: VariableSizeListProps) {
        super(props);

        // @ts-ignore
        if (this._getItemStyle) {
            const oldGetItemStyle = this._getItemStyle;

            // @ts-ignore
            super._getItemStyle = this._getItemStyle = (index: number) => {
                const style = oldGetItemStyle(index);

                const token = JSON.stringify(style);

                if (styleCaches[JSON.stringify(style)]) {
                    return styleCaches[token];
                }
                
                return styleCaches[token] = style;
            };
        }
    }
}

export default function DynamicSizeList<T, MemoState>(props: DynamicSizeListProps<T, MemoState>) {
    const listRef = useRef<PatchedVariableSizeList | null>(null);
    const sizeMap = React.useRef<{ [key: string]: number }>({});

    const resetList = useCallback(() => listRef.current?.resetAfterIndex(0), [listRef]);

    const setSize = React.useCallback((id: string, size: number) => {
        // Performance: Only update the sizeMap and reset cache if an actual value changed
        if (sizeMap.current[id] !== size) {
            sizeMap.current = { ...sizeMap.current, [id]: size };
            sizeStorage.set(props.nonce!, sizeMap.current);
            
            if (listRef.current) {
                // Clear cached data and rerender
                resetList();
            }
        }
    }, [props.nonce, listRef, resetList, sizeMap]);

    useEffect(() => {
        resetList();
    }, [props.itemData]);

    useEffect(() => {
        sizeMap.current = sizeStorage.get(props.nonce!) || {};
        listRef.current?.resetAfterIndex(0);
        listRef.current?.scrollToItem(0);
    }, [props.nonce]);

    const getSize = React.useCallback((index: number) => (
        sizeMap.current[props.getID(index, props.itemData)] || (typeof props.defaultSize === "number" ? props.defaultSize : 25)
    ), [props.itemData, sizeMap, props.defaultSize]);

    // Increases accuracy by calculating an average row height
    // Fixes the scrollbar behaviour described here: https://github.com/bvaughn/react-window/issues/408
    const calcEstimatedSize = React.useCallback(() => {
        const keys = Object.keys(sizeMap.current);
        const estimatedHeight = keys.reduce((p, i) => p + sizeMap.current[i], 0);
        return estimatedHeight / keys.length;
    }, [sizeMap]);

    const getProps: (index: number) => object | undefined = useCallback(props.getProps || (() => undefined), [props.getProps]);

    const MemoizedRowMeasurer = useMemo(() => props.isSame ? React.memo<RowMeasurerProps<T, MemoState>>(RowMeasurer, (prevProps, nextProps) => {
        return areEqual(prevProps, nextProps) && props.isSame!(prevProps, nextProps) && shallowequal(prevProps.rootProps, nextProps.rootProps);
    }) : RowMeasurer, [props.isSame]);

    const itemKey = useCallback((index: number) => props.getID(index, props.itemData), [props.getID, props.itemData]);

    return (
        <DynamicListContext.Provider value={{ setSize }}>
            <PatchedVariableSizeList
                ref={listRef}
                innerRef={props.innerRef}
                width={props.width}
                height={props.height}
                itemCount={props.itemData.length}
                itemData={props.itemData}
                itemSize={getSize}
                estimatedItemSize={calcEstimatedSize()}
                outerRef={props.outerRef}
                overscanCount={props.overscanCount}
                onItemsRendered={props.nearEnd ? ({ overscanStopIndex }) => overscanStopIndex >= (props.itemData.length - 10) ? props.nearEnd!() : undefined : undefined}
                itemKey={itemKey}
                >
                {rowProps => (
                    <MemoizedRowMeasurer {...rowProps} rootProps={getProps(rowProps.index)} id={props.getID(rowProps.index, props.itemData)} width={props.width} memoState={props.memoState} key={props.getID(rowProps.index, props.itemData)}>
                        {props.children}
                    </MemoizedRowMeasurer>
                )}
            </PatchedVariableSizeList>
        </DynamicListContext.Provider>
    );
}