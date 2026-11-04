package catalog

import (
	"reflect"
	"testing"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		path    string
		cat     string
		group   string
		sizes   []string
		depth   int
		heights []int
		variant string
		piece   string
	}{
		{"01. DRAWERS/01. S Families/S3/Modules/S3 Module 4f.stl", "drawers", "Modules", []string{"S"}, 3, []int{4}, "", ""},
		{"01. DRAWERS/01. S Families/S5/Roofs/S5 Under Table Mount Roof.stl", "drawers", "Roofs", []string{"S"}, 5, nil, "under-table", ""},
		{"01. DRAWERS/03. L Families/L3/Roofs/L3 Heawyweight Roof.stl", "drawers", "Roofs", []string{"L"}, 3, nil, "heavyweight", ""},
		{"01. DRAWERS/04. L² Families/L3²/L3² Module 2F.stl", "drawers", "Modules", []string{"L2"}, 3, []int{2}, "", ""},
		{"01. DRAWERS/06. XL² Families/XL5²/XL5² Module 1F.stl", "drawers", "Modules", []string{"XL2"}, 5, []int{1}, "", ""},
		{"01. DRAWERS/05. XL Families/XL7/Boxes/XL7 Box 1F Part 2.stl", "drawers", "Boxes", []string{"XL"}, 7, []int{1}, "", "2"},
		{"01. DRAWERS/01. S Families/S3/Gridfinity Baseplate/S3 Baseplate_With 2 Handles.stl", "drawers", "Baseplates", []string{"S"}, 3, nil, "baseplate-2-handles", ""},
		{"01. DRAWERS/02. M Families/Facades/M2F (Turn On Supports).stl", "drawers", "Facades", []string{"M"}, 0, []int{2}, "", ""},
		{"01. DRAWERS/07. Universal/Runners/x4 Runner Guide.stl", "drawers", "Universal", nil, 4, nil, "", ""},
		{"01. DRAWERS/07. Universal/Runners/XL Runners/x5 Runner Slide XL.stl", "drawers", "Universal", []string{"XL"}, 5, nil, "", ""},
		{"01. DRAWERS/07. Universal/Geared Rails/M Rails.stl", "drawers", "Universal", []string{"M"}, 0, nil, "", ""},
		{"02. SUSTAINERS/03. L Families/L4/Modules/L4 2F Sealed Module.stl", "sustainers", "Modules", []string{"L"}, 4, []int{2}, "sealed", ""},
		{"02. SUSTAINERS/03. L Families/Facades/L4F' Facade.stl", "sustainers", "Facades", []string{"L"}, 0, []int{4}, "", ""},
		{"02. SUSTAINERS/01. S Families/S6/Roofs/S6 Roof Part 1.stl", "sustainers", "Roofs", []string{"S"}, 6, nil, "", "1"},
		{"02. SUSTAINERS/05. Universal/Hinges/S-M 2-4F Hinge.stl", "sustainers", "Universal", []string{"S", "M"}, 0, []int{2, 4}, "", ""},
		{"02. SUSTAINERS/05. Universal/Hinges/L-XL 1F Hinge.stl", "sustainers", "Universal", []string{"L", "XL"}, 0, []int{1}, "", ""},
		{"02. SUSTAINERS/05. Universal/Baseplates/04. XL/XL6 Part 1  Gridfinity Baseplate.stl", "sustainers", "Baseplates", []string{"XL"}, 6, nil, "", "1"},
		{"03. MODIFICATIONS/Base/M/M7 Base Whole.stl", "modifications", "Base", []string{"M"}, 7, nil, "", "whole"},
		{"03. MODIFICATIONS/Feet/XL Feet.stl", "modifications", "Feet", []string{"XL"}, 0, nil, "", ""},
		{"03. MODIFICATIONS/Backbone/L1F Backbone.stl", "modifications", "Backbone", []string{"L"}, 0, []int{1}, "", ""},
		{"03. MODIFICATIONS/Wall Mounts/XL1F Wall Mount.stl", "modifications", "Wall Mounts", []string{"XL"}, 0, []int{1}, "", ""},
		{"VAULT_USSA/03. MODIFICATIONS/Pull-out Handle/S Pull-out Handle.stl", "modifications", "Pull-out Handle", []string{"S"}, 0, nil, "", ""},
	}
	for _, c := range cases {
		p := Classify(c.path)
		if p.Category != c.cat || p.Group != c.group || !reflect.DeepEqual(p.Sizes, c.sizes) ||
			p.Depth != c.depth || !reflect.DeepEqual(p.Heights, c.heights) || p.Variant != c.variant || p.Piece != c.piece {
			t.Errorf("%s\n got cat=%q group=%q sizes=%v depth=%d heights=%v variant=%q piece=%q",
				c.path, p.Category, p.Group, p.Sizes, p.Depth, p.Heights, p.Variant, p.Piece)
		}
	}
}

func TestClassifySealDivider(t *testing.T) {
	p := Classify("02. SUSTAINERS/05. Universal/Dividers/L Seal Dividers/L-2F Seal Divider.stl")
	if !reflect.DeepEqual(p.Sizes, []string{"L"}) || !reflect.DeepEqual(p.Heights, []int{2}) {
		t.Errorf("got sizes=%v heights=%v", p.Sizes, p.Heights)
	}
}

func TestCleanFolderKeepsDecimals(t *testing.T) {
	for in, want := range map[string]string{
		"01. DRAWERS":  "DRAWERS",
		"2_Depth_50mm": "Depth_50mm",
		"34.5MM TALL (full height of 1F drawers)": "34.5MM TALL (full height of 1F drawers)",
		"82.5MM TALL (full height of 2F drawers)": "82.5MM TALL (full height of 2F drawers)",
	} {
		if got := CleanFolder(in); got != want {
			t.Errorf("CleanFolder(%q) = %q, want %q", in, got, want)
		}
	}
}
