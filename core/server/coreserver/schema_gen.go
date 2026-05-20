package coreserver

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"github.com/pocketbase/pocketbase/core"
)

// GenerateSchemas writes pbSchema.ts and pbZodSchema.ts for all
// non-system collections to typesDir.
func GenerateSchemas(app core.App, typesDir string) {
	collections, err := app.FindAllCollections()
	if err != nil {
		log.Printf("Schema generation: failed to find collections: %v", err)
		return
	}

	var filtered []*core.Collection
	for _, c := range collections {
		if !c.System {
			filtered = append(filtered, c)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].Name < filtered[j].Name
	})

	tsSchema := generateTsSchema(filtered)
	zodSchema := generateZodSchema(filtered)

	if err := os.MkdirAll(typesDir, 0o755); err != nil {
		log.Printf("Schema generation: failed to create types dir: %v", err)
		return
	}

	tsPath := filepath.Join(typesDir, "pbSchema.ts")
	zodPath := filepath.Join(typesDir, "pbZodSchema.ts")

	if err := os.WriteFile(tsPath, []byte(tsSchema), 0o644); err != nil {
		log.Printf("Schema generation: failed to write %s: %v", tsPath, err)
	} else {
		log.Printf("Schema generation: wrote %s", tsPath)
	}

	if err := os.WriteFile(zodPath, []byte(zodSchema), 0o644); err != nil {
		log.Printf("Schema generation: failed to write %s: %v", zodPath, err)
	} else {
		log.Printf("Schema generation: wrote %s", zodPath)
	}
}

func generateTsSchema(collections []*core.Collection) string {
	collectionIDToName := make(map[string]string)
	for _, c := range collections {
		collectionIDToName[c.Id] = c.Name
	}

	var sb strings.Builder

	type fieldSet []string
	var allFieldSets []fieldSet
	needsUniqueIdentifier := false

	for _, collection := range collections {
		var fields fieldSet
		sb.WriteString(fmt.Sprintf("export interface %s {\n", toPascalCase(collection.Name)))

		for _, field := range collection.Fields {
			typeDef := tsFieldType(field, collectionIDToName)
			sb.WriteString(fmt.Sprintf("    %s\n", typeDef))
			fields = append(fields, typeDef)
		}

		for _, prev := range allFieldSets {
			if sameStringSlice(prev, fields) {
				needsUniqueIdentifier = true
				sb.WriteString("    readonly [uniqueIdentifier]: unique symbol\n")
				break
			}
		}

		sb.WriteString("}\n\n")
		allFieldSets = append(allFieldSets, fields)
	}

	result := sb.String()
	if needsUniqueIdentifier {
		result = "declare const uniqueIdentifier: unique symbol\n\n" + result
	}

	result += generatePbTsSchema(collections, collectionIDToName)

	return formatTS(result)
}

func tsFieldType(field core.Field, collectionIDToName map[string]string) string {
	name := field.GetName()

	switch f := field.(type) {
	case *core.TextField:
		return fmt.Sprintf("%s: string", name)
	case *core.PasswordField:
		return fmt.Sprintf("%s: string", name)
	case *core.EditorField:
		return fmt.Sprintf("%s: string", name)
	case *core.NumberField:
		return fmt.Sprintf("%s: number", name)
	case *core.BoolField:
		if f.Required {
			return fmt.Sprintf("%s: true", name)
		}
		return fmt.Sprintf("%s: boolean", name)
	case *core.EmailField:
		return fmt.Sprintf("%s: string", name)
	case *core.URLField:
		return fmt.Sprintf("%s: string", name)
	case *core.DateField:
		return fmt.Sprintf("%s: string", name)
	case *core.AutodateField:
		return fmt.Sprintf("%s: string", name)
	case *core.SelectField:
		options := make([]string, len(f.Values))
		for i, v := range f.Values {
			options[i] = fmt.Sprintf("'%s'", v)
		}
		optionsStr := strings.Join(options, " | ")
		if f.MaxSelect > 1 {
			if f.Required {
				return fmt.Sprintf("%s: [%s, ...(%s)[]]", name, optionsStr, optionsStr)
			}
			return fmt.Sprintf("%s: (%s)[]", name, optionsStr)
		}
		return fmt.Sprintf("%s: %s", name, optionsStr)
	case *core.FileField:
		if f.MaxSelect > 1 {
			if f.Required {
				return fmt.Sprintf("%s: [string, ...string[]]", name)
			}
			return fmt.Sprintf("%s: string[]", name)
		}
		return fmt.Sprintf("%s: string", name)
	case *core.RelationField:
		if f.MaxSelect > 1 {
			if f.Required {
				return fmt.Sprintf("%s: [string, ...string[]]", name)
			}
			return fmt.Sprintf("%s: string[]", name)
		}
		return fmt.Sprintf("%s: string", name)
	case *core.JSONField:
		return fmt.Sprintf("%s: any", name)
	case *core.GeoPointField:
		return fmt.Sprintf("%s: { lon: number; lat: number }", name)
	default:
		return fmt.Sprintf("%s: any", name)
	}
}

func generatePbTsSchema(collections []*core.Collection, collectionIDToName map[string]string) string {
	relationMap := make(map[string][]string)
	for _, c := range collections {
		relationMap[c.Name] = nil
	}

	for _, collection := range collections {
		uniqueFields := make(map[string]bool)
		for _, idxStr := range collection.Indexes {
			if strings.Contains(idxStr, "UNIQUE") && !strings.Contains(idxStr, ",") {
				re := regexp.MustCompile(`CREATE UNIQUE.+\(` + "`?" + `([^` + "`" + `\s]+).*\)`)
				matches := re.FindStringSubmatch(idxStr)
				if len(matches) > 1 {
					uniqueFields[matches[1]] = true
				}
			}
		}

		for _, field := range collection.Fields {
			rf, ok := field.(*core.RelationField)
			if !ok {
				continue
			}

			relatedName, exists := collectionIDToName[rf.CollectionId]
			if !exists {
				continue
			}

			optionalMark := ""
			if !rf.Required {
				optionalMark = "?"
			}
			suffix := ""
			if rf.MaxSelect > 1 {
				suffix = "[]"
			}
			forward := fmt.Sprintf("%s%s: %s%s", rf.GetName(), optionalMark, toPascalCase(relatedName), suffix)
			relationMap[collection.Name] = append(relationMap[collection.Name], forward)

			hasUnique := uniqueFields[rf.GetName()]
			backRelation := fmt.Sprintf("%s_via_%s?: %s", collection.Name, rf.GetName(), toPascalCase(collection.Name))
			if !hasUnique {
				backRelation = "// " + backRelation + "[]"
			}
			relationMap[relatedName] = append(relationMap[relatedName], backRelation)
		}
	}

	var sb strings.Builder
	sb.WriteString(`
/**
 * Commented-out back-relations are what will be inferred by pocketbase-ts from the forward relations.
 *
 * The "UNIQUE index constraint" case is automatically handled by this hook,
 * but if you want to make a back-relation non-nullable, you can uncomment it and remove the "?".
 *
 * See https://github.com/satohshi/pocketbase-ts#back-relations for more information.
 */
export type Schema = {
`)

	for _, c := range collections {
		sb.WriteString(fmt.Sprintf("    %s: {\n", c.Name))
		sb.WriteString(fmt.Sprintf("        type: %s\n", toPascalCase(c.Name)))

		relations := relationMap[c.Name]
		if len(relations) > 0 {
			sb.WriteString("        relations: {\n")
			for _, rel := range relations {
				sb.WriteString(fmt.Sprintf("            %s\n", rel))
			}
			sb.WriteString("        }\n")
		}

		sb.WriteString("    }\n")
	}

	sb.WriteString("}\n")
	return sb.String()
}

func generateZodSchema(collections []*core.Collection) string {
	collectionIDToIDSchema := make(map[string]string)
	for _, c := range collections {
		for _, field := range c.Fields {
			if field.GetName() == "id" {
				if tf, ok := field.(*core.TextField); ok {
					collectionIDToIDSchema[c.Id] = zodTextFieldSchema(tf)
				}
				break
			}
		}
	}

	hasDate := false
	for _, c := range collections {
		for _, field := range c.Fields {
			switch field.(type) {
			case *core.DateField, *core.AutodateField:
				hasDate = true
			}
		}
	}

	var sb strings.Builder
	sb.WriteString("import { z } from 'zod'\n\n")
	if hasDate {
		sb.WriteString(`const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?Z$/`)
		sb.WriteString("\n\n")
	}

	for _, collection := range collections {
		sb.WriteString(fmt.Sprintf("export const %sSchema = z.object({\n", toCamelCase(collection.Name)))

		for _, field := range collection.Fields {
			optional := isZodOptional(field)
			zodType := zodFieldType(field, collectionIDToIDSchema)
			optionalSuffix := ""
			if optional {
				optionalSuffix = ".optional()"
			}
			sb.WriteString(fmt.Sprintf("    %s%s,\n", zodType, optionalSuffix))
		}

		sb.WriteString("})\n\n")
	}

	return sb.String()
}

func isZodOptional(field core.Field) bool {
	switch f := field.(type) {
	case *core.TextField:
		return !f.Required || f.AutogeneratePattern != ""
	case *core.PasswordField:
		return !f.Required
	case *core.EditorField:
		return !f.Required
	case *core.NumberField:
		return !f.Required
	case *core.BoolField:
		return !f.Required
	case *core.EmailField:
		return !f.Required
	case *core.URLField:
		return !f.Required
	case *core.DateField:
		return !f.Required
	case *core.AutodateField:
		return true
	case *core.SelectField:
		return !f.Required
	case *core.FileField:
		return !f.Required
	case *core.RelationField:
		return !f.Required
	case *core.JSONField:
		return !f.Required
	case *core.GeoPointField:
		return !f.Required
	default:
		return true
	}
}

func zodFieldType(field core.Field, collectionIDToIDSchema map[string]string) string {
	name := field.GetName()

	switch f := field.(type) {
	case *core.TextField:
		return zodTextFieldSchemaWithName(f)
	case *core.PasswordField:
		schema := fmt.Sprintf("%s: z.string()", name)
		if f.Min > 0 && f.Min == f.Max {
			schema += fmt.Sprintf(".length(%d)", f.Min)
		} else {
			if f.Min > 0 {
				schema += fmt.Sprintf(".min(%d)", f.Min)
			} else if f.Required {
				schema += ".min(1)"
			}
			if f.Max > 0 {
				schema += fmt.Sprintf(".max(%d)", f.Max)
			}
		}
		return schema
	case *core.EditorField:
		schema := fmt.Sprintf("%s: z.string()", name)
		if f.Required {
			schema += ".min(1)"
		}
		return schema
	case *core.NumberField:
		schema := fmt.Sprintf("%s: z.number()", name)
		if f.OnlyInt {
			schema += ".int()"
		}
		if f.Min != nil && *f.Min != 0 {
			schema += fmt.Sprintf(".min(%g)", *f.Min)
		}
		if f.Max != nil && *f.Max != 0 {
			schema += fmt.Sprintf(".max(%g)", *f.Max)
		}
		if f.Required {
			schema += ".refine((n) => n !== 0)"
		}
		return schema
	case *core.BoolField:
		if f.Required {
			return fmt.Sprintf("%s: z.literal(true)", name)
		}
		return fmt.Sprintf("%s: z.boolean()", name)
	case *core.EmailField:
		schema := fmt.Sprintf("%s: z.string().email()", name)
		if len(f.OnlyDomains) > 0 {
			domains := quotedJoin(f.OnlyDomains)
			schema += fmt.Sprintf(`.refine((v) => [%s].includes(v.split('@')[1]))`, domains)
		} else if len(f.ExceptDomains) > 0 {
			domains := quotedJoin(f.ExceptDomains)
			schema += fmt.Sprintf(`.refine((v) => ![%s].includes(v.split('@')[1]))`, domains)
		}
		return schema
	case *core.URLField:
		schema := fmt.Sprintf("%s: z.string().url()", name)
		if len(f.OnlyDomains) > 0 {
			domains := quotedJoin(f.OnlyDomains)
			schema += fmt.Sprintf(`.refine((v) => [%s].some((domain) => v.includes(domain)))`, domains)
		} else if len(f.ExceptDomains) > 0 {
			domains := quotedJoin(f.ExceptDomains)
			schema += fmt.Sprintf(`.refine((v) => [%s].every((domain) => !v.includes(domain)))`, domains)
		}
		return schema
	case *core.DateField:
		return fmt.Sprintf("%s: z.string().regex(DATETIME_REGEX)", name)
	case *core.AutodateField:
		return fmt.Sprintf("%s: z.string().regex(DATETIME_REGEX)", name)
	case *core.SelectField:
		values := make([]string, len(f.Values))
		for i, v := range f.Values {
			values[i] = fmt.Sprintf(`"%s"`, v)
		}
		schema := fmt.Sprintf("%s: z.enum([%s])", name, strings.Join(values, ", "))
		if f.MaxSelect > 1 {
			schema += ".array()"
			if f.Required {
				schema += ".nonempty()"
			}
			if f.MaxSelect > 0 {
				schema += fmt.Sprintf(".max(%d)", f.MaxSelect)
			}
		}
		return schema
	case *core.FileField:
		schema := fmt.Sprintf("%s: z.string()", name)
		if f.MaxSelect > 1 {
			schema += ".array()"
			if f.Required {
				schema += ".nonempty()"
			}
			if f.MaxSelect > 0 {
				schema += fmt.Sprintf(".max(%d)", f.MaxSelect)
			}
		}
		return schema
	case *core.RelationField:
		targetSchema := "z.string()"
		if idSchema, ok := collectionIDToIDSchema[f.CollectionId]; ok {
			targetSchema = idSchema
		}
		targetSchema = strings.TrimPrefix(targetSchema, "id: ")
		schema := fmt.Sprintf("%s: %s", name, targetSchema)
		if f.MaxSelect > 1 {
			schema += ".array()"
			if f.Required {
				schema += ".nonempty()"
			}
			if f.MinSelect > 0 {
				schema += fmt.Sprintf(".min(%d)", f.MinSelect)
			}
			if f.MaxSelect > 0 {
				schema += fmt.Sprintf(".max(%d)", f.MaxSelect)
			}
		}
		return schema
	case *core.JSONField:
		return fmt.Sprintf("%s: z.unknown()", name)
	case *core.GeoPointField:
		schema := fmt.Sprintf("%s: z.object({ lon: z.number(), lat: z.number() })", name)
		if f.Required {
			schema += ".refine(({ lon, lat }) => !(lon === 0 && lat === 0))"
		}
		return schema
	default:
		return fmt.Sprintf("%s: z.unknown()", name)
	}
}

func zodTextFieldSchema(f *core.TextField) string {
	schema := fmt.Sprintf("%s: z.string()", f.GetName())
	if f.Pattern != "" {
		schema += fmt.Sprintf(".regex(/%s/)", f.Pattern)
	}
	if f.Min > 0 && f.Min == f.Max {
		schema += fmt.Sprintf(".length(%d)", f.Min)
	} else {
		if f.Min > 0 {
			schema += fmt.Sprintf(".min(%d)", f.Min)
		} else if f.Required {
			schema += ".min(1)"
		}
		if f.Max > 0 {
			schema += fmt.Sprintf(".max(%d)", f.Max)
		}
	}
	return schema
}

func zodTextFieldSchemaWithName(f *core.TextField) string {
	return zodTextFieldSchema(f)
}

func toPascalCase(s string) string {
	parts := strings.Split(s, "_")
	for i, part := range parts {
		if len(part) > 0 {
			runes := []rune(part)
			runes[0] = unicode.ToUpper(runes[0])
			parts[i] = string(runes)
		}
	}
	return strings.Join(parts, "")
}

func toCamelCase(s string) string {
	pascal := toPascalCase(s)
	if len(pascal) == 0 {
		return pascal
	}
	runes := []rune(pascal)
	runes[0] = unicode.ToLower(runes[0])
	return string(runes)
}

func sameStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func quotedJoin(strs []string) string {
	quoted := make([]string, len(strs))
	for i, s := range strs {
		quoted[i] = fmt.Sprintf(`"%s"`, s)
	}
	return strings.Join(quoted, ", ")
}

func formatTS(input string) string {
	if !strings.Contains(input, "\n") {
		return input
	}
	lines := strings.Split(input, "\n")
	indent := 0
	var output strings.Builder
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			output.WriteString("\n")
			continue
		}
		if strings.HasSuffix(trimmed, "}") && !strings.Contains(trimmed, "{") {
			indent--
			if indent < 0 {
				indent = 0
			}
		}
		output.WriteString(strings.Repeat("    ", indent))
		output.WriteString(trimmed)
		output.WriteString("\n")
		if strings.HasSuffix(trimmed, "{") {
			indent++
		}
	}
	return output.String()
}
