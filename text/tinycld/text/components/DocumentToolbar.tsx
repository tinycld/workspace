import { HelpSearchButton } from '@tinycld/core/components/help/HelpSearchButton'
import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    Baseline,
    Bold,
    Code,
    Code2,
    Grid3x3,
    Heading1,
    Heading2,
    Heading3,
    Highlighter,
    Image as ImageIcon,
    Indent,
    Italic,
    Link2,
    List,
    ListOrdered,
    Outdent,
    PaintBucket,
    Quote,
    Redo2,
    Table as TableIcon,
    Underline,
    Undo2,
} from 'lucide-react-native'
import type { ComponentType, ReactNode } from 'react'
import { useState } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import { BorderMenu } from './BorderMenu'
import { NewCommentButton } from './comments/NewCommentButton'
import { FontFamilyPicker } from './FontFamilyPicker'
import { FontSizePicker } from './FontSizePicker'
import { ImageInsertButton } from './ImageInsertButton'
import { LinkPopover } from './LinkPopover'
import { ShadingMenu } from './ShadingMenu'
import { TableMenu } from './TableMenu'
import { TextColorButton } from './TextColorButton'
import { ToolbarTooltip } from './ToolbarTooltip'

interface DocumentToolbarProps {
    commands: EditorCommands
    state: EditorToolbarState
    disabled?: boolean
    // Handles for the inline new-comment trigger. Omit when the toolbar
    // hosts a doc without the comment system mounted.
    newCommentFlow?: {
        canStart: boolean
        isOpen: boolean
        start: () => void
    }
}

// DocumentToolbar lays out the editor's formatting actions in groups
// (marks, headings, lists/blockquote, link, table, image, history). The
// `disabled` prop greys out every button without unmounting them — the
// read-only state in serverHello drives this, and remounting the
// toolbar would cause the popovers (link, table) to drop their state
// every time the room reconnects.
export function DocumentToolbar({
    commands,
    state,
    disabled = false,
    newCommentFlow,
}: DocumentToolbarProps) {
    const iconColor = useThemeColor('muted-foreground')
    const activeColor = useThemeColor('primary')
    const [linkOpen, setLinkOpen] = useState(false)
    const [tableOpen, setTableOpen] = useState(false)
    const [borderOpen, setBorderOpen] = useState(false)
    const [shadingOpen, setShadingOpen] = useState(false)
    const isInTable = state.isInTable ?? false

    return (
        <View className="border-b border-border overflow-visible">
            <ToolbarRow>
                <View className="flex-row items-center gap-0.5 px-2 py-1.5 overflow-visible">
                    <FontFamilyPicker
                        currentFamily={state.currentFontFamily ?? null}
                        commands={commands}
                        disabled={disabled}
                    />
                    <FontSizePicker
                        currentPx={state.currentFontSize ?? null}
                        commands={commands}
                        disabled={disabled}
                    />

                    <Separator />

                    <FormatButton
                        icon={Bold}
                        accessibilityLabel="Bold"
                        isActive={state.isBoldActive}
                        disabled={disabled}
                        onPress={() => commands.toggleBold()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Italic}
                        accessibilityLabel="Italic"
                        isActive={state.isItalicActive}
                        disabled={disabled}
                        onPress={() => commands.toggleItalic()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Underline}
                        accessibilityLabel="Underline"
                        isActive={state.isUnderlineActive}
                        disabled={disabled}
                        onPress={() => commands.toggleUnderline()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Code}
                        accessibilityLabel="Inline code"
                        isActive={state.isCodeActive ?? false}
                        disabled={disabled}
                        onPress={() => commands.toggleCode?.()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Code2}
                        accessibilityLabel="Code block"
                        isActive={state.isCodeBlockActive ?? false}
                        disabled={disabled}
                        onPress={() => commands.toggleCodeBlock?.()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />

                    <TextColorButton
                        icon={Baseline}
                        accessibilityLabel="Text color"
                        menuKey="text-color"
                        color={state.currentTextColor ?? undefined}
                        disabled={disabled}
                        iconColor={iconColor}
                        onSelect={value => {
                            if (value === '') {
                                commands.unsetTextColor?.()
                            } else {
                                commands.setTextColor?.(value)
                            }
                        }}
                    />
                    <TextColorButton
                        icon={Highlighter}
                        accessibilityLabel="Highlight color"
                        menuKey="background-color"
                        color={state.currentBackgroundColor ?? undefined}
                        disabled={disabled}
                        iconColor={iconColor}
                        onSelect={value => {
                            if (value === '') {
                                commands.unsetBackgroundColor?.()
                            } else {
                                commands.setBackgroundColor?.(value)
                            }
                        }}
                    />

                    <Separator />

                    <FormatButton
                        icon={Heading1}
                        accessibilityLabel="Heading 1"
                        isActive={state.activeHeadingLevel === 1}
                        disabled={disabled}
                        onPress={() => commands.toggleHeading(1)}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Heading2}
                        accessibilityLabel="Heading 2"
                        isActive={state.activeHeadingLevel === 2}
                        disabled={disabled}
                        onPress={() => commands.toggleHeading(2)}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Heading3}
                        accessibilityLabel="Heading 3"
                        isActive={state.activeHeadingLevel === 3}
                        disabled={disabled}
                        onPress={() => commands.toggleHeading(3)}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />

                    <Separator />

                    <FormatButton
                        icon={List}
                        accessibilityLabel="Bullet list"
                        isActive={state.isBulletListActive}
                        disabled={disabled}
                        onPress={() => commands.toggleBulletList()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={ListOrdered}
                        accessibilityLabel="Ordered list"
                        isActive={state.isOrderedListActive}
                        disabled={disabled}
                        onPress={() => commands.toggleOrderedList()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Quote}
                        accessibilityLabel="Blockquote"
                        isActive={state.isBlockquoteActive}
                        disabled={disabled}
                        onPress={() => commands.toggleBlockquote()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />

                    <Separator />

                    <FormatButton
                        icon={AlignLeft}
                        accessibilityLabel="Align left"
                        isActive={state.currentAlign === 'left' || state.currentAlign == null}
                        disabled={disabled}
                        onPress={() => commands.setTextAlign?.('left')}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={AlignCenter}
                        accessibilityLabel="Align center"
                        isActive={state.currentAlign === 'center'}
                        disabled={disabled}
                        onPress={() => commands.setTextAlign?.('center')}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={AlignRight}
                        accessibilityLabel="Align right"
                        isActive={state.currentAlign === 'right'}
                        disabled={disabled}
                        onPress={() => commands.setTextAlign?.('right')}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={AlignJustify}
                        accessibilityLabel="Justify"
                        isActive={state.currentAlign === 'justify'}
                        disabled={disabled}
                        onPress={() => commands.setTextAlign?.('justify')}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Outdent}
                        accessibilityLabel="Decrease indent"
                        isActive={false}
                        disabled={disabled || !(state.canOutdent ?? false)}
                        onPress={() => commands.outdentBlock?.()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Indent}
                        accessibilityLabel="Increase indent"
                        isActive={false}
                        disabled={disabled || !(state.canIndent ?? false)}
                        onPress={() => commands.indentBlock?.()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />

                    <Separator />

                    <FormatButton
                        icon={Link2}
                        accessibilityLabel="Link"
                        isActive={state.isLinkActive}
                        disabled={disabled}
                        onPress={() => setLinkOpen(true)}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <TableMenu
                        isOpen={tableOpen}
                        onOpenChange={setTableOpen}
                        isInTable={isInTable}
                        canMergeCells={state.canMergeCells ?? false}
                        canSplitCell={state.canSplitCell ?? false}
                        commands={commands}
                        trigger={
                            <FormatButton
                                icon={TableIcon}
                                accessibilityLabel="Table"
                                isActive={isInTable}
                                disabled={disabled}
                                onPress={() => undefined}
                                iconColor={iconColor}
                                activeColor={activeColor}
                            />
                        }
                    />
                    <FormatButton
                        icon={Grid3x3}
                        accessibilityLabel="Cell borders"
                        isActive={false}
                        disabled={disabled || !isInTable}
                        onPress={() => setBorderOpen(true)}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={PaintBucket}
                        accessibilityLabel="Cell shading"
                        isActive={false}
                        disabled={disabled || !isInTable}
                        onPress={() => setShadingOpen(true)}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <ImageInsertButton
                        icon={ImageIcon}
                        disabled={disabled}
                        onInsert={url => commands.insertImage?.(url)}
                        iconColor={iconColor}
                    />

                    <Separator />

                    <FormatButton
                        icon={Undo2}
                        accessibilityLabel="Undo"
                        isActive={false}
                        disabled={disabled}
                        onPress={() => commands.undo()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                    <FormatButton
                        icon={Redo2}
                        accessibilityLabel="Redo"
                        isActive={false}
                        disabled={disabled}
                        onPress={() => commands.redo()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />

                    <View className="ml-auto flex-row items-center">
                        {newCommentFlow ? (
                            <>
                                <Separator />
                                <NewCommentButton
                                    canStart={newCommentFlow.canStart}
                                    isOpen={newCommentFlow.isOpen}
                                    onPress={newCommentFlow.start}
                                />
                            </>
                        ) : null}
                        <HelpSearchButton />
                    </View>
                </View>
            </ToolbarRow>

            <LinkPopover
                isOpen={linkOpen}
                initialUrl={state.currentLink ?? ''}
                onCancel={() => setLinkOpen(false)}
                onInsert={url => {
                    if (url) {
                        commands.setLink(url)
                    } else {
                        commands.removeLink()
                    }
                    setLinkOpen(false)
                }}
            />

            <BorderMenu
                isOpen={borderOpen}
                onClose={() => setBorderOpen(false)}
                commands={commands}
            />

            <ShadingMenu
                isOpen={shadingOpen}
                onClose={() => setShadingOpen(false)}
                commands={commands}
            />
        </View>
    )
}

// On web we render a plain overflow-visible row so hover tooltips
// (which extend above the row) aren't clipped by react-native-web's
// ScrollView, which sets overflow-y:hidden on its horizontal scroller.
// RN-Web's View defaults to overflow:hidden too, so `overflow-visible`
// is needed even without a ScrollView — same pattern as @tinycld/calc's
// Toolbar. Native keeps the horizontal ScrollView so the row stays
// swipeable on narrow widths; there's no hover surface to clip there.
function ToolbarRow({ children }: { children: ReactNode }) {
    if (Platform.OS === 'web') {
        return <View className="overflow-visible">{children}</View>
    }
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {children}
        </ScrollView>
    )
}

interface FormatButtonProps {
    icon: ComponentType<{ size: number; color: string }>
    accessibilityLabel: string
    isActive: boolean
    disabled: boolean
    onPress: () => void
    iconColor: string
    activeColor: string
}

function FormatButton({
    icon: Icon,
    accessibilityLabel,
    isActive,
    disabled,
    onPress,
    iconColor,
    activeColor,
}: FormatButtonProps) {
    const backgroundColor = isActive && !disabled ? `${activeColor}22` : undefined
    const opacity = disabled ? 0.4 : 1
    const color = isActive && !disabled ? activeColor : iconColor
    // Stop the mousedown from moving DOM focus off the ProseMirror
    // editor. ProseMirror's blur handler collapses its selection on
    // focus loss, which makes selection-derived UI (e.g. the Table
    // popover deciding between "insert grid" and "row/col ops") read
    // stale state on the next render. The toolbar buttons all act on
    // a selection in the editor, so they should never take focus.
    // Web-only — on native there's no DOM focus model and the prop is
    // silently dropped by RN.
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}
    return (
        <ToolbarTooltip label={accessibilityLabel}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled, selected: isActive }}
                disabled={disabled}
                onPress={onPress}
                {...webProps}
                className="rounded-md p-1.5"
                style={{ backgroundColor, opacity }}
                hitSlop={
                    Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }
                }
            >
                <Icon size={16} color={color} />
            </Pressable>
        </ToolbarTooltip>
    )
}

function Separator() {
    return <View className="w-px h-5 mx-1 bg-border" />
}
