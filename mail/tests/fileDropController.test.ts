import { describe, expect, it, vi } from 'vitest'
import {
    createFileDropController,
    type DataTransferLike,
    extractDroppedFiles,
} from '../tinycld/mail/hooks/fileDropController'

function makeFile(name: string, size = 10): File {
    return new File([new Uint8Array(size)], name)
}

function makeDataTransfer(files: File[]): DataTransferLike {
    return {
        files: files as unknown as FileList,
        dropEffect: 'none',
    }
}

describe('extractDroppedFiles', () => {
    it('returns an array from a non-empty FileList', () => {
        const a = makeFile('a.txt')
        const b = makeFile('b.txt')
        const dt = makeDataTransfer([a, b])
        expect(extractDroppedFiles(dt)).toEqual([a, b])
    })

    it('returns [] when there are no files (e.g., text drag)', () => {
        const dt = makeDataTransfer([])
        expect(extractDroppedFiles(dt)).toEqual([])
    })

    it('returns [] when dataTransfer is null/undefined', () => {
        expect(extractDroppedFiles(null)).toEqual([])
        expect(extractDroppedFiles(undefined)).toEqual([])
    })
})

describe('createFileDropController', () => {
    function setup(isEnabled = true) {
        const onChange = vi.fn<(isDragging: boolean) => void>()
        const onFiles = vi.fn<(files: File[]) => void>()
        const controller = createFileDropController({ onChange, onFiles, isEnabled })
        return { controller, onChange, onFiles }
    }

    it('isDragging is false initially', () => {
        const { controller } = setup()
        expect(controller.isDragging()).toBe(false)
    })

    it('enter sets dragging true exactly once', () => {
        const { controller, onChange } = setup()
        controller.enter()
        expect(controller.isDragging()).toBe(true)
        expect(onChange).toHaveBeenCalledWith(true)
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('two enters then one leave keeps dragging true', () => {
        const { controller, onChange } = setup()
        controller.enter()
        controller.enter()
        controller.leave()
        expect(controller.isDragging()).toBe(true)
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('two enters then two leaves clears dragging', () => {
        const { controller, onChange } = setup()
        controller.enter()
        controller.enter()
        controller.leave()
        controller.leave()
        expect(controller.isDragging()).toBe(false)
        expect(onChange).toHaveBeenLastCalledWith(false)
    })

    it('drop with files calls onFiles and resets dragging', () => {
        const { controller, onChange, onFiles } = setup()
        const file = makeFile('x.png')
        controller.enter()
        controller.enter()
        controller.drop([file])
        expect(onFiles).toHaveBeenCalledWith([file])
        expect(controller.isDragging()).toBe(false)
        expect(onChange).toHaveBeenLastCalledWith(false)
    })

    it('drop with no files does not call onFiles but still resets', () => {
        const { controller, onChange, onFiles } = setup()
        controller.enter()
        controller.drop([])
        expect(onFiles).not.toHaveBeenCalled()
        expect(controller.isDragging()).toBe(false)
        expect(onChange).toHaveBeenLastCalledWith(false)
    })

    it('drop while disabled is a no-op for onFiles but still resets dragging', () => {
        const { controller, onFiles } = setup(false)
        const file = makeFile('y.png')
        controller.enter()
        controller.drop([file])
        expect(onFiles).not.toHaveBeenCalled()
        expect(controller.isDragging()).toBe(false)
    })

    it('extra leaves do not drive the counter negative', () => {
        const { controller, onChange } = setup()
        controller.leave()
        controller.leave()
        expect(controller.isDragging()).toBe(false)
        controller.enter()
        expect(controller.isDragging()).toBe(true)
        expect(onChange).toHaveBeenLastCalledWith(true)
    })

    it('reset clears the counter and dragging state', () => {
        const { controller, onChange } = setup()
        controller.enter()
        controller.enter()
        expect(controller.isDragging()).toBe(true)
        controller.reset()
        expect(controller.isDragging()).toBe(false)
        expect(onChange).toHaveBeenLastCalledWith(false)
        // After reset, a single leave should not toggle anything (counter is at 0).
        controller.leave()
        expect(controller.isDragging()).toBe(false)
    })
})
